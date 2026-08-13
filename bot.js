// ----------------------------------------------------
// Discord Bot 訊息監聽與關鍵字回應
// ----------------------------------------------------
client.on('messageCreate', async (message) => {
  // 1. 忽略所有機器人發出的訊息（防止機器人之間互相對話造成無限迴圈）
  if (message.author.bot) return;

  // 將訊息轉為小寫並去除前後空白，方便比對
  const rawContent = message.content.trim();
  const lowerContent = rawContent.toLowerCase();

  // --------------------------------------------------
  // [觸發 1] 原本的賽況指令（精準匹配）
  // --------------------------------------------------
  if (lowerContent === '!賽況' || lowerContent === '!bg') {
    const loadingMsg = await message.reply('🔍 正在抓取 CPBL 最新賽況，請稍候...');

    try {
      const matchesData = await fetchMatches();
      const todayStr = getTaiwanDate();
      let output = `📢 **中華職棒 賽況回報 (${todayStr})**\n\n`;

      if (matchesData.length > 0) {
        matchesData.forEach((m, idx) => output += `**場次 ${idx + 1}**\n${formatMatchInfo(m)}\n───────────────────\n`);
      } else {
        output += `ℹ️ 今日 (${todayStr}) 尚無賽事資料或為休兵日。\n`;
      }

      await loadingMsg.edit(output);
    } catch (error) {
      console.error('即時指令觸發失敗:', error);
      await loadingMsg.edit('❌ 抓取賽況失敗，請稍後再試。');
    }
    return; // 處理完畢直接結束，避免重複觸發其他關鍵字
  }

  // --------------------------------------------------
  // [觸發 2] 簡單測試連線指令
  // --------------------------------------------------
  if (lowerContent === 'ping') {
    await message.reply('pong! 🏓 機器人目前在 Zeabur 穩定運作中！');
    return;
  }

  // --------------------------------------------------
  // [觸發 3] 包含關鍵字觸發（模糊匹配 .includes）
  // --------------------------------------------------

  // 範例 A：提及職棒或 CPBL 時引導使用者使用 !賽況
  if (lowerContent.includes('職棒') || lowerContent.includes('cpbl') || lowerContent.includes('今天有比賽嗎')) {
    await message.reply(`⚾ 想看最新的職棒賽況嗎？請輸入 \`!賽況\` 或 \`!bg\`，我會幫你即時抓取！`);
    return;
  }

  // 範例 B：打招呼關鍵字（標記發言者）
  if (lowerContent.includes('你好') || lowerContent.includes('早安') || lowerContent.includes('哈囉')) {
    await message.reply(`👋 你好呀 <@${message.author.id}>！祝你有個美好的一天！⚾`);
    return;
  }

  // 範例 C：多種關鍵字回應（以關鍵字字典方式延展）
  const autoReplies = {
    '兄弟': '🐘 爪爪加油！',
    '統一': '🦁 飛獅條款！尚勇！',
    '味全': '🐉 龍眾一心！',
    '樂天': '🦅 Ready for More!',
    '富邦': '🌊 悍將出擊！',
    '台鋼': '🦅 鷹雄齊聚！'
  };

  for (const [key, replyText] of Object.entries(autoReplies)) {
    if (lowerContent.includes(key)) {
      await message.reply(replyText);
      return;
    }
  }
});