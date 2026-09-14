import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = 'C:\\Users\\USER\\.gemini\\antigravity\\brain\\e3ebd5ff-d281-4e84-af0c-5b216c3f4893\\scratch\\chrome_cdp_profile_ui_upload_subject_test';
const artifactImg = 'C:\\Users\\USER\\.gemini\\antigravity\\brain\\e3ebd5ff-d281-4e84-af0c-5b216c3f4893\\upload_timetable_any_subject_count.png';

import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('c:/Users/USER/Desktop/New folder (2)/server/data/academic.db');
db.exec('DELETE FROM active_sessions;');

const testCsvPath = 'C:\\Users\\USER\\.gemini\\antigravity\\brain\\e3ebd5ff-d281-4e84-af0c-5b216c3f4893\\scratch\\test_many_subjects.csv';
const testCsvContent = `Day,Hour,Subject,Faculty,Room
Monday,1,Deep Learning,,ET-4015
Tuesday,2,Deep Learning,,ET-4015
Wednesday,3,Deep Learning,,ET-4015
Thursday,4,Deep Learning,,ET-4015`;
fs.writeFileSync(testCsvPath, testCsvContent);

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9266',
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-first-run',
  '--window-size=1600,1100',
  'http://localhost:3000'
]);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://localhost:9266/json');
      const tabs = await res.json();
      const pageTab = tabs.find(t => t.type === 'page');
      if (pageTab && pageTab.webSocketDebuggerUrl) return pageTab.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Chrome CDP port 9266 not responsive');
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    return new Promise((resolve) => {
      this.ws.onopen = () => resolve();
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error('Eval error: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result ? res.result.value : undefined;
  }
}

async function run() {
  try {
    const wsUrl = await getWsUrl();
    const client = new CDPClient(wsUrl);
    await client.ready();
    await client.send('Page.enable');
    await client.send('DOM.enable');

    console.log('Navigating to http://localhost:3000...');
    await client.send('Page.navigate', { url: 'http://localhost:3000' });
    await sleep(2000);

    // Direct login via auth endpoint to set sessionStorage
    const loginResult = await client.eval(`
      (async () => {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ register_id: 'admin01', password: '1352468' })
          });
          const data = await res.json();
          if (data.token) {
            sessionStorage.setItem('rgmcet_auth_user', JSON.stringify(data.user));
            sessionStorage.setItem('rgmcet_auth_token', data.token);
            window.location.reload();
            return { ok: true, user: data.user };
          }
          return { ok: false, error: data.error };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()
    `);
    console.log('Login result:', loginResult);
    await sleep(2500);

    // Click "Upload Timetable" button
    console.log('Clicking "Upload Timetable" button...');
    await client.eval(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const uploadBtn = buttons.find(b => b.textContent.includes('Upload Timetable'));
        if (uploadBtn) uploadBtn.click();
      })()
    `);
    await sleep(1000);

    // Set file input files using DOM.setFileInputFiles
    console.log('Uploading test CSV with 4 occurrences of "Deep Learning"...');
    const doc = await client.send('DOM.getDocument');
    const fileNode = await client.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#timetable-file-input'
    });

    await client.send('DOM.setFileInputFiles', {
      files: [testCsvPath],
      nodeId: fileNode.nodeId
    });

    await sleep(2500);

    // Check modal contents
    const modalText = await client.eval(`
      (() => {
        const modal = document.querySelector('.animate-scale-up');
        return modal ? modal.innerText : '';
      })()
    `);
    console.log('\n--- Modal State ---');
    console.log(modalText);

    const hasSuccess = modalText.includes('Timetable validated successfully!');
    const hasSubjectError = modalText.toLowerCase().includes('maximum of 2 times') || modalText.toLowerCase().includes('is scheduled');
    const hasCreateBtn = modalText.includes('Create');

    console.log('\nHas success validation intimation?', hasSuccess);
    console.log('Has subject limit error?', hasSubjectError);
    console.log('Has Create button active?', hasCreateBtn);

    // Capture screenshot
    const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(artifactImg, Buffer.from(screenshot.data, 'base64'));
    console.log('Saved screenshot to:', artifactImg);

    if (hasSuccess && !hasSubjectError && hasCreateBtn) {
      console.log('\n✅ UI VERIFICATION PASSED: File with 4 occurrences of a subject validated and accepted!');
    } else {
      console.error('\n❌ UI VERIFICATION FAILED');
      process.exit(1);
    }

  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  } finally {
    try { chrome.kill(); } catch (e) {}
  }
}

run();
