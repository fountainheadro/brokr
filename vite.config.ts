import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(env.GOOGLE_MAPS_PLATFORM_KEY || env.VITE_GOOGLE_MAPS_API_KEY || ""),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@design': path.resolve(__dirname, 'design'),
        '@ui': path.resolve(__dirname, 'src/ui'),
        '@core': path.resolve(__dirname, 'src/core'),
        '@server': path.resolve(__dirname, 'server'),
        '@ai': path.resolve(__dirname, 'ai'),
        '@lib': path.resolve(__dirname, 'lib'),
        '@pkg': path.resolve(__dirname, 'packages'),
        '@config': path.resolve(__dirname, 'config'),
        '~': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
