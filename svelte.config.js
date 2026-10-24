import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    adapter: adapter({ out: 'build', precompress: true }),
    serviceWorker: { register: false },
    // Content Security Policy; SvelteKit adds a nonce for its own inline scripts and the theme script in app.html.
    // Inline styles are needed for style attributes; images may come from icon CDNs or any https URL in services.yaml.
    csp: {
      mode: 'nonce',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:', 'https:'],
        'font-src': ['self'],
        'connect-src': ['self'],
        'manifest-src': ['self'],
        'worker-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'frame-ancestors': ['none']
      }
    }
  }
};
