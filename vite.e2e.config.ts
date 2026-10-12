import {defineConfig,mergeConfig} from 'vite';
import base from './vite.config.js';
export default mergeConfig(base,defineConfig({server:{proxy:{'/api':'http://127.0.0.1:8790'}}}));
