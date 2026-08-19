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
    await new Promise(r => setTimeout(r, 4000));

    const records = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tr'));
      const results = [];

      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(c => c.innerText.trim());
        if (cells.length > 0) {
          const fullRow = cells.join(' | ');
          if (fullRow.length > 0) {
            results.push({
              fullRow,
              cells
            });
          }
        }
      }

      // 備用機制：若非 HTML <table>，抓取含有日期格式的區塊
      if (results.length === 0) {
        const elements = Array.from(document.querySelectorAll('div, li, p'));
        for (const el of elements) {
          const txt = (el.innerText || '').trim().replace(/\s+/g, ' ');
          if (/\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(txt) && txt.length < 200 && txt.length > 10) {
            results.push({ fullRow: txt, cells: [txt] });
          }
        }
      }

      return results;
    });

    await browser.close();
    return records;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

module.exports = {
  fetchCPBLData,
  fetchRosterMovements
};