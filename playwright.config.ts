import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:5178',browserName:'chromium',channel:process.env.CI ? undefined : 'msedge',headless:true,trace:'retain-on-failure'},
  webServer:[
    {command:'npm run server',url:'http://127.0.0.1:8790/api/health',reuseExistingServer:false,
      env:{PORT:'8790',LLM_MODE:'mock',TELECOM_DATA_DIR:'.data/e2e'}},
    {command:'npm exec vite -- --host 127.0.0.1 --port 5178 --strictPort --config vite.e2e.config.ts',url:'http://127.0.0.1:5178',reuseExistingServer:false,
      env:{TELECOM_API_URL:'http://127.0.0.1:8790'}},
  ],
});
