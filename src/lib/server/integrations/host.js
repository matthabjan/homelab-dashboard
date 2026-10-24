// Host temperatures from the kernel's hwmon interface — the same source homepage's
// resources widget uses (via systeminformation). Inside an LXC/Docker container the kernel
// is the Proxmox host's, so these are the host's real CPU / NVMe / drive temperatures.
import fs from 'node:fs/promises';
import path from 'node:path';
/** @import { Temps } from '$lib/types' */

const HWMON = process.env.HWMON_DIR || '/sys/class/hwmon';
const CPU_DRIVERS = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'soc_thermal', 'acpitz'];

async function readNum(file) {
  try { return Number((await fs.readFile(file, 'utf8')).trim()); } catch { return null; }
}
async function readStr(file) {
  try { return (await fs.readFile(file, 'utf8')).trim(); } catch { return null; }
}

export async function readTemps() {
  let dirs;
  try { dirs = await fs.readdir(HWMON); } catch { return null; }
  /** @type {Temps} */
  const out = { cpu: null, nvme: [], drives: [] };
  for (const d of dirs) {
    const dir = path.join(HWMON, d);
    const name = await readStr(path.join(dir, 'name'));
    if (!name) continue;
    let files;
    try { files = (await fs.readdir(dir)).filter((f) => /^temp\d+_input$/.test(f)); } catch { continue; }
    const temps = [];
    for (const f of files) {
      const v = await readNum(path.join(dir, f));
      if (v == null || v <= 0) continue;
      temps.push({ label: (await readStr(path.join(dir, f.replace('_input', '_label')))) || '', c: v / 1000 });
    }
    if (!temps.length) continue;
    if (CPU_DRIVERS.includes(name)) {
      const pref = temps.find((t) => /Package id 0|Tctl|Tdie/i.test(t.label)) || temps.reduce((a, b) => (b.c > a.c ? b : a));
      // prefer real CPU drivers over acpitz
      if (out.cpu == null || name !== 'acpitz') out.cpu = pref.c;
    } else if (name === 'nvme') {
      out.nvme.push((temps.find((t) => /Composite/i.test(t.label)) || temps[0]).c);
    } else if (name === 'drivetemp') {
      out.drives.push(temps[0].c);
    }
  }
  return out.cpu == null && !out.nvme.length && !out.drives.length ? null : out;
}
