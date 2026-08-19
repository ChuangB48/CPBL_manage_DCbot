// scraper.js
const puppeteer = require('puppeteer');

/**
 * 1. 抓取今日 CPBL 賽事資料（供語音頻道與賽事播報使用）
 */
async function fetchCPBLData() {
  const targetUrl = 'https://www.cpbl.com.tw/';
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36'
    );

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    // 等待動態賽事卡片載入
    await new Promise(r => setTimeout(r, 4000));

    const matches = await page.evaluate(() => {
      // 搜尋 CPBL 首頁賽事區塊卡片
      const cards = Array.from(document.querySelectorAll('.game_box, .game-item, .schedule_box'));
      
      if (cards.length > 0) {
        return cards.map((card, index) => {
          const text = card.innerText.trim();
          const gameMatch = text.match(/GAME\s*\d+/i);
          return {
            gameId: gameMatch ? gameMatch[0].toUpperCase() : `GAME${index + 1}`,
            rawText: text
          };
        });
      }

      // 備用機制：抓取所有含有 GAME 文字且長度合理的 DOM 區塊
      const allElements = Array.from(document.querySelectorAll('div, section, li'));
      const gameElements = allElements.filter(el => {
        const txt = el.innerText || '';
        return /GAME\s*\d+/i.test(txt) && txt.length > 10 && txt.length < 300;
      });

      const uniqueResults = [];
      const seenTexts = new Set();

      for (const el of gameElements) {
        const text = el.innerText.trim().replace(/\s+/g, '\n');
        if (!seenTexts.has(text)) {
          seenTexts.add(text);
          const gameMatch = text.match(/GAME\s*\d+/i);
          uniqueResults.push({
            gameId: gameMatch ? gameMatch[0].toUpperCase() : `GAME${uniqueResults.length + 1}`,
            rawText: text
          });
        }
      }

      return uniqueResults;
    });

    await browser.close();
    return matches;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * 2. 抓取 CPBL 球員異動與新聞公告（供球員異動專屬頻道使用）
 */
// scraper.js (fetchRosterMovements 部分)
async function fetchRosterMovements() {
  const targetUrl = 'https://www.cpbl.com.tw/player/trans';
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36'
    );

    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    // 關鍵：強制等待表格或列表渲染完成
    try {
      await page.waitForSelector('table, .table, tr', { timeout: 10000 });
    } catch (e) {
      console.log('⚠️ 等待表格選擇器逾時，嘗試直接解析頁面...');
    }

    await new Promise(r => setTimeout(r, 3000));

    const result = await page.evaluate(() => {
      const parsedRecords = [];

      // 1. 優先抓取 <table> 裡的每列數據 <tr>
      const trs = Array.from(document.querySelectorAll('tr'));
      for (const tr of trs) {
        const tds = Array.from(tr.querySelectorAll('td, th')).map(td =>
          (td.innerText || '').trim().replace(/\s+/g, ' ')
        );
        if (tds.length >= 2) {
          parsedRecords.push(tds.join(' | '));
        }
      }

      // 2. 備用方案：若沒抓到 table，按行拆分整頁文字，找含有日期的行
      if (parsedRecords.length === 0) {
        const lines = (document.body.innerText || '')
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          if (/\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(line)) {
            parsedRecords.push(line);
          }
        }
      }

      return {
        records: parsedRecords,
        bodySnippet: (document.body.innerText || '').slice(0, 200).replace(/\s+/g, ' ')
      };
    });

    await browser.close();
    return result;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

module.exports = {
  fetchCPBLData,
  fetchRosterMovements
};