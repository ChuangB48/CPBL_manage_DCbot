process.env.TZ = 'Asia/Taipei';

const puppeteer = require('puppeteer');
const axios = require('axios');
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CATEGORY_ID = process.env.DISCORD_CATEGORY_ID;

// 判斷當前執行模式 (預設依台灣時間判斷：凌晨 1~5 點為重置模式，其餘時間為更新模式)
const currentHour = parseInt(new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }), 10);
const EXEC_MODE = process.env.MODE || (currentHour >= 1 && currentHour <= 5 ? 'reset' : 'update');

function getTaiwanDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

// 發送 Discord 文字訊息 (via Webhook)
async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  const chunks = content.match(/[\s\S]{1,1900}/g) || [content];
  for (const chunk of chunks) {
    await axios.post(DISCORD_WEBHOOK_URL, { content: chunk });
    await new Promise(r => setTimeout(r, 500));
  }
}

// 格式化單場賽事文字卡片
function formatMatchInfo(matchObj) {
  const { gameId, rawText, inning, pitcher, batter } = matchObj;
  const rawLines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  let gameType = '';
  let status = '';
  let time = '';
  let score = '';
  let otherLines = [];

  for (const line of rawLines) {
    if (/GAME\d+/i.test(line)) continue;
    
    if (/例行賽|熱身賽|明星賽|季後賽|總冠軍賽/.test(line)) {
      gameType = line;
    } else if (/未開始|進行中|已結束|延賽|因雨延賽|裁定/.test(line)) {
      status = line;
    } else if (/^\d{1,2}:\d{2}$/.test(line)) {
      time = line;
    } else if (/^\d+\s*[:：]\s*\d+$/.test(line)) {
      score = line;
    } else if (/^\d+-\d+-\d+$/.test(line)) {
      // 忽略戰績
    } else if (line.toLowerCase() === 'vs') {
      // 忽略 vs
    } else {
      otherLines.push(line);
    }
  }

  // 1. 狀態與局數
  let statusStr = status || '未開始';
  if (statusStr === '進行中') {
    statusStr = inning ? `進行中 (${inning})` : '進行中';
  }

  // 2. 隊名與球場
  let awayTeam = '';
  let homeTeam = '';
  let venue = '';

  if (otherLines.length >= 3) {
    awayTeam = otherLines[0];
    homeTeam = otherLines[otherLines.length - 1];
    venue = otherLines.slice(1, -1).join(' / ');
  } else if (otherLines.length === 2) {
    awayTeam = otherLines[0];
    homeTeam = otherLines[1];
  } else if (otherLines.length === 1) {
    awayTeam = otherLines[0];
  }

  matchObj.awayTeam = awayTeam;
  matchObj.homeTeam = homeTeam;

  // 3. 組合標題與基本資訊
  let header = `⚾ **${gameId}**`;
  if (gameType) header += ` *(${gameType})*`;

  let infoParts = [];
  infoParts.push(`📌 **狀態**：${statusStr}`);
  if (time) infoParts.push(`⏰ **${time}**`);
  if (venue) infoParts.push(`📍 **${venue}**`);

  let infoLine = `> ${infoParts.join(' ｜ ')}`;

  // 4. 對戰隊伍 / 比分
  let matchupLine = '';
  if (score) {
    matchupLine = `> ⚔️ **${awayTeam || '客隊'}** \`${score}\` **${homeTeam || '主隊'}**`;
  } else if (awayTeam && homeTeam) {
    matchupLine = `> ⚔️ **${awayTeam}** vs **${homeTeam}**`;
  } else if (otherLines.length > 0) {
    matchupLine = `> ⚔️ ${otherLines.join(' vs ')}`;
  }

  // 5. 當前投手 vs 打者
  let pbLine = '';
  if (pitcher || batter) {
    const pStr = pitcher ? `🎯 投手：**${pitcher}**` : '';
    const bStr = batter ? `🏏 打者：**${batter}**` : '';
    pbLine = `> ${[pStr, bStr].filter(Boolean).join('  vs  ')}`;
  }

  return [header, infoLine, matchupLine, pbLine].filter(Boolean).join('\n');
}

// 語音頻道管理
async function manageVoiceChannels(matchesData, isResetMode) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    console.log("未設定 DISCORD_BOT_TOKEN 或 DISCORD_GUILD_ID，跳過語音頻道管理。");
    return;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(DISCORD_BOT_TOKEN);
    const guild = await client.guilds.fetch(DISCORD_GUILD_ID);

    let category = null;
    if (DISCORD_CATEGORY_ID) {
      try {
        category = await guild.channels.fetch(DISCORD_CATEGORY_ID);
        if (category && category.type !== ChannelType.GuildCategory) {
          console.error(`❌ 設定的 ID (${DISCORD_CATEGORY_ID}) 不是類別！`);
          category = null;
        }
      } catch (e) {
        console.error(`❌ 找不到類別 ID (${DISCORD_CATEGORY_ID})`, e.message);
      }
    }

    if (!category) {
      console.error("⚠️ 未取得有效類別，跳過語音頻道管理。");
      return;
    }

    const existingVoiceChannels = Array.from(
      guild.channels.cache.filter(
        c => c.parentId === category.id && c.type === ChannelType.GuildVoice
      ).values()
    );

    if (isResetMode) {
      // ---------------- 【凌晨重置模式】 ----------------
      console.log(`🗑️ [Reset 模式] 開始清理舊頻道，共 ${existingVoiceChannels.length} 個...`);
      for (const channel of existingVoiceChannels) {
        try {
          await channel.delete('每日凌晨定時重置：刪除舊頻道');
          console.log(`  - 已刪除舊頻道：${channel.name}`);
        } catch (err) {
          console.error(`  - 刪除頻道 ${channel.name} 失敗:`, err.message);
        }
      }

      console.log(`✨ [Reset 模式] 為今日賽事建立全新頻道，共 ${matchesData.length} 場...`);
      for (const match of matchesData) {
        let channelName = (match.awayTeam && match.homeTeam)
          ? `⚔️ ${match.awayTeam} vs ${match.homeTeam}`
          : `⚔️ ${match.gameId} 對戰組合未定`;
        
        channelName = channelName.slice(0, 100);
        // 語音狀態只顯示場次
        const voiceStatus = `⚾ ${match.gameId}`;

        try {
          const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: category.id,
          });

          try {
            await client.rest.put(
              `/channels/${channel.id}/voice-status`,
              { body: { status: voiceStatus } }
            );
          } catch (err) {
            console.error(`無法設定 ${match.gameId} 的語音狀態:`, err.message);
          }

          console.log(`  + 已建立頻道：${channelName} (${voiceStatus})`);
        } catch (err) {
          console.error(`建立 ${match.gameId} 頻道失敗:`, err.message);
        }
      }
    } else {
      // ---------------- 【賽事期間更新模式】 ----------------
      console.log(`🔄 [Update 模式] 確認並更新語音狀態（僅顯示場次，不顯示比分）...`);
      for (const match of matchesData) {
        const targetChannel = existingVoiceChannels.find(
          c => c.name.includes(match.gameId) || (match.awayTeam && c.name.includes(match.awayTeam))
        );

        if (targetChannel) {
          // 狀態保持簡潔，只顯示場次
          const voiceStatus = `⚾ ${match.gameId}`;

          try {
            await client.rest.put(
              `/channels/${targetChannel.id}/voice-status`,
              { body: { status: voiceStatus } }
            );
            console.log(`  ✓ 已設定 ${targetChannel.name} 語音狀態為: ${voiceStatus}`);
          } catch (err) {
            console.error(`設定頻道 ${targetChannel.name} 狀態失敗:`, err.message);
          }
        }
      }
    }

    console.log(`✅ 語音頻道處理完成！`);
  } catch (error) {
    console.error("管理語音頻道時發生錯誤:", error);
  } finally {
    client.destroy();
  }
}

async function main() {
  const isResetMode = EXEC_MODE === 'reset';
  const modeName = isResetMode ? '凌晨每日重置' : '賽事即時戰況更新';
  console.log(`[${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}] 模式：[${modeName}] - 開始執行...`);

  const targetUrl = 'https://stats.cpbl.com.tw/';
  const browser = await puppeteer.launch({ 
    headless: "new", 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  
  try {
    const page = await browser.newPage();
    await page.emulateTimezone('Asia/Taipei');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 6000));

    // 1. 抓取賽事卡片資料
    const matchesData = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      
      const candidateDivs = allDivs.filter(div => {
        const text = div.innerText.trim();
        const gameMatches = text.match(/GAME\d+/gi) || [];
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        return gameMatches.length === 1 && lines.length >= 3 && lines.length <= 25;
      });

      candidateDivs.sort((a, b) => a.innerText.length - b.innerText.length);

      const seen = new Set();
      const results = [];

      for (const card of candidateDivs) {
        const text = card.innerText.trim();
        const gameIdMatch = text.match(/GAME\d+/gi);
        if (!gameIdMatch) continue;
        const gameId = gameIdMatch[0].toUpperCase();

        if (seen.has(gameId)) continue;
        seen.add(gameId);

        const anchor = card.querySelector('a') || card.closest('a');
        const boxUrl = anchor ? anchor.href : '';

        results.push({
          gameId,
          rawText: text,
          boxUrl,
          status: text.includes('進行中') ? '進行中' : '其他'
        });
      }

      return results;
    });

    // 2. 進行中賽事進詳細頁爬取局數與投打
    for (let match of matchesData) {
      if (match.status === '進行中' && match.boxUrl) {
        let detailPage = null;
        try {
          detailPage = await browser.newPage();
          await detailPage.emulateTimezone('Asia/Taipei');
          await detailPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
          await detailPage.goto(match.boxUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await new Promise(r => setTimeout(r, 3000));

          const detailData = await detailPage.evaluate(() => {
            const fullText = document.body.innerText;

            let inning = '';
            const inningMatch = fullText.match(/(\d{1,2}|[一二三四五六七八九十]+)\s*局?\s*([上下])/);
            if (inningMatch) {
              inning = `${inningMatch[1]}局${inningMatch[2]}`;
            }

            const invalidNames = [
              '局數', '打席', '打數', '安打', '得分', '打點', '三振', '四壞', '四死',
              '失分', '自責分', '投球數', '防禦率', '先發', '替補', '成績', '紀錄',
              '投手', '打者', '守備', '代打', '代跑', '勝投', '敗投', '救援', '出局'
            ];

            let pitcher = '';
            const pMatches = Array.from(fullText.matchAll(/(?:投手|投\s*手|P)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g));
            for (const m of pMatches) {
              const candidate = m[1].trim();
              if (!invalidNames.some(inv => candidate.includes(inv))) {
                pitcher = candidate;
                break;
              }
            }

            let batter = '';
            const bMatches = Array.from(fullText.matchAll(/(?:打者|打\s*者|B)\s*[:：]?\s*([\u4e00-\u9fa5·•]{2,8})/g));
            for (const m of bMatches) {
              const candidate = m[1].trim();
              if (!invalidNames.some(inv => candidate.includes(inv))) {
                batter = candidate;
                break;
              }
            }

            return { inning, pitcher, batter };
          });

          match.inning = detailData.inning;
          match.pitcher = detailData.pitcher;
          match.batter = detailData.batter;
        } catch (e) {
          console.error(`無法取得 ${match.gameId} 詳細資料:`, e.message);
        } finally {
          if (detailPage) {
            await detailPage.close();
          }
        }
      }
    }

    await browser.close();

    // 3. 發送 Discord Webhook 卡片
    const todayStr = getTaiwanDate();
    const titleHeader = isResetMode 
      ? `📢 **中華職棒 今日賽程預告 (${todayStr})**\n\n`
      : `⚡ **中華職棒 即時戰況播報 (${todayStr})**\n\n`;

    let output = titleHeader;
    if (matchesData.length > 0) {
      matchesData.forEach((matchObj, idx) => {
        const formattedCard = formatMatchInfo(matchObj);
        output += `**場次 ${idx + 1}**\n${formattedCard}\n───────────────────\n`;
      });
    } else {
      output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
    }

    await sendToDiscord(output);

    // 4. 管理 Discord 語音頻道
    await manageVoiceChannels(matchesData, isResetMode);

  } catch (error) {
    console.error("執行發生錯誤:", error);
  }
}

main();