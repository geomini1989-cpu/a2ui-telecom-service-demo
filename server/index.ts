import 'dotenv/config';
import {createApp} from './app.js';
const {app, store} = createApp();
const port = Number(process.env.PORT || 8787);
const server = app.listen(port, () => console.log(`A2UI demo server http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close(() => {store.close(); process.exit(0);});
});
