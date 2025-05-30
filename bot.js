require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer; // You can also try LancasterStemmer
const axios = require('axios');
const fuzz = require('fuzzball');
const { InlineKeyboardButton, InlineKeyboardMarkup } = require('node-telegram-bot-api');

console.log("Starting WordSpotr bot...");

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userFilters = {}; // userId -> filter object
const userSavedWords = {}; // userId -> array of saved words
const notifiedTokens = {}; // userId -> Set of notified token addresses

const botFeatures = [
  '• Search for tokens by phrase or sentence using /checktoken',
  '• Set and customize trading filters with /checkfilter',
  '• Save up to 5 words for token launch alerts with /saveword',
  '• Get notified when a token matching your saved words launches',
  '• Use /help to see this message again'
];

function getWelcomeMessage() {
  return `👋 Welcome to WordSpotr Bot!

This bot helps you:
${botFeatures.join('\n')}
\nCommands you can try:
/start
/checktoken <sentence> — e.g. /checktoken nothing will be forgiven
/checkfilter
/saveword <word1> <word2> ... (max 5) — e.g. /saveword nothing forgiven hope moon pepe
/mysavedwords
/clearsavedwords
/help`;
}

// Set Telegram command list for clickable suggestions
bot.setMyCommands([
  { command: 'start', description: 'Show welcome message and bot features' },
  { command: 'checktoken', description: 'Search for tokens by phrase or sentence (add your sentence after the command)' },
  { command: 'checkfilter', description: 'Set or update your trading filters' },
  { command: 'saveword', description: 'Save up to 5 words for token launch alerts (add your words after the command)' },
  { command: 'mysavedwords', description: 'Show your current saved words' },
  { command: 'clearsavedwords', description: 'Clear your saved words' },
  { command: 'help', description: 'Show help and bot features' }
]);

function getFilterButtons(filters) {
  return [
    [{ text: `Market Cap${filters.fdv ? ` = $${filters.fdv}` : ''}`, callback_data: 'set_filter_fdv' }],
    [{ text: `Liquidity${filters.liquidity ? ` = $${filters.liquidity}` : ''}`, callback_data: 'set_filter_liquidity' }],
    [{ text: `Volume Buy${filters.volumeBuy ? ` = $${filters.volumeBuy}` : ''}`, callback_data: 'set_filter_volumeBuy' }],
    [{ text: `Volume Sell${filters.volumeSell ? ` = $${filters.volumeSell}` : ''}`, callback_data: 'set_filter_volumeSell' }],
    [{ text: `Blockchain${filters.blockchain ? ` = ${filters.blockchain}` : ''}`, callback_data: 'set_filter_blockchain' }],
    [{ text: 'Done', callback_data: 'set_filter_done' }]
  ];
}

function getBlockchainButtons() {
  return {
    inline_keyboard: [
      [ { text: 'Solana (SOL)', callback_data: 'choose_chain_SOL' } ],
      [ { text: 'Binance Smart Chain (BNB)', callback_data: 'choose_chain_BNB' } ],
      [ { text: 'TON', callback_data: 'choose_chain_TON' } ],
      [ { text: 'Ethereum (ETH)', callback_data: 'choose_chain_ETH' } ],
      [ { text: 'Back', callback_data: 'set_filter_back' } ]
    ]
  };
}

function getNumericFilterButtons(filterKey) {
  return {
    inline_keyboard: [
      [ { text: '>10,000', callback_data: `numfilter_${filterKey}_gt_10000` } ],
      [ { text: '>50,000', callback_data: `numfilter_${filterKey}_gt_50000` } ],
      [ { text: '<10,000', callback_data: `numfilter_${filterKey}_lt_10000` } ],
      [ { text: '<50,000', callback_data: `numfilter_${filterKey}_lt_50000` } ],
      [ { text: 'Custom Range', callback_data: `numfilter_${filterKey}_custom` } ],
      [ { text: 'Back', callback_data: 'set_filter_back' } ]
    ]
  };
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, getWelcomeMessage());
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, getWelcomeMessage());
});

bot.onText(/\/checkfilter/, (msg) => {
  const chatId = msg.chat.id;
  userFilters[chatId] = userFilters[chatId] || { filters: {} };
  userFilters[chatId].awaitingFilterKey = null; // Reset any pending filter input

  const filterButtons = getFilterButtons(userFilters[chatId].filters || {});

  bot.sendMessage(chatId,
    "Please set your preferred filters. Tap a filter to set its value. You can change them anytime by sending /checkfilter again.",
    { reply_markup: { inline_keyboard: filterButtons } }
  );
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  // Only handle value input for the interactive filter system
  if (
    userFilters[chatId] &&
    userFilters[chatId].awaitingFilterKey &&
    msg.text &&
    !msg.text.startsWith('/')
  ) {
    const key = userFilters[chatId].awaitingFilterKey;
    userFilters[chatId].filters = userFilters[chatId].filters || {};
    userFilters[chatId].filters[key] = msg.text;
    userFilters[chatId].awaitingFilterKey = null;
    // Edit the previous message to update the buttons
    const filterButtons = getFilterButtons(userFilters[chatId].filters);
    bot.sendMessage(chatId, `${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} set to ${msg.text}. You can set another filter or tap Done.`,
      { reply_markup: { inline_keyboard: filterButtons } }
    );
  }
  // Handle custom range input for numeric filters
  if (
    userFilters[chatId] &&
    userFilters[chatId].awaitingCustomRange &&
    msg.text &&
    !msg.text.startsWith('/')
  ) {
    const filterKey = userFilters[chatId].awaitingCustomRange;
    const match = msg.text.match(/min\s*(\d+)\s*max\s*(\d+)/i);
    if (match) {
      const min = parseFloat(match[1]);
      const max = parseFloat(match[2]);
      userFilters[chatId].filters[filterKey] = { min, max };
      userFilters[chatId].awaitingCustomRange = null;
      const filterButtons = getFilterButtons(userFilters[chatId].filters);
      bot.sendMessage(chatId, `${filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} set to min ${min} max ${max}. You can set another filter or tap Done.`,
        { reply_markup: { inline_keyboard: filterButtons } }
      );
    } else {
      bot.sendMessage(chatId, 'Invalid format. Please enter in the format: min 10000 max 50000');
    }
    return;
  }
});

bot.onText(/\/checktoken(?:\s+([\s\S]+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1] ? match[1].trim() : '';
  if (!input) {
    bot.sendMessage(chatId, 'Please add your sentence after the command, e.g. /checktoken nothing will be forgiven');
    return;
  }
  // Split input into words, separating filters (e.g., fdv>50000)
  const parts = input.split(/\s+/);
  const filterParts = parts.filter(p => p.includes('>') || p.includes('<') || p.includes('='));
  const sentenceParts = parts.filter(p => !filterParts.includes(p));
  const sentence = sentenceParts.join(' ');

  // Parse filters from command
  let filters = {};
  filterParts.forEach(f => {
    const match = f.match(/(fdv|liquidity|price|volume)([<>=]+)(\d+(\.\d+)?)/i);
    if (match) {
      const [, key, op, value] = match;
      filters[key.toLowerCase()] = { op, value: parseFloat(value) };
    }
  });

  // If no filters in command, use saved filters
  if (Object.keys(filters).length === 0 && userFilters[chatId] && userFilters[chatId].filters) {
    filters = userFilters[chatId].filters;
  }

  const tokens = tokenizer.tokenize(sentence);
  const stemmedTokens = tokens.map(token => stemmer.stem(token));

  let allPairs = [];
  for (const query of stemmedTokens) {
    try {
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/search/?q=${query}`);
      const pairs = response.data.pairs || [];
      allPairs = allPairs.concat(pairs);
    } catch (error) {
      console.error(error);
    }
  }

  // Remove duplicate tokens by contract address
  const uniquePairs = [];
  const seenAddresses = new Set();
  for (const pair of allPairs) {
    if (pair.baseToken && pair.baseToken.address && !seenAddresses.has(pair.baseToken.address)) {
      uniquePairs.push(pair);
      seenAddresses.add(pair.baseToken.address);
    }
  }

  if (uniquePairs.length === 0) {
    bot.sendMessage(chatId, 'No tokens found matching your input.');
    return;
  }

  // Update filtering logic in /checktoken
  const filteredPairs = uniquePairs.filter(pair => {
    let passes = true;
    if (filters.fdv) passes = passes && passesNumericFilter(pair.fdv, filters.fdv);
    if (filters.liquidity) passes = passes && passesNumericFilter(pair.liquidity && pair.liquidity.usd, filters.liquidity);
    if (filters.volumeBuy) passes = passes && passesNumericFilter(pair.volume && pair.volume.buy, filters.volumeBuy);
    if (filters.volumeSell) passes = passes && passesNumericFilter(pair.volume && pair.volume.sell, filters.volumeSell);
    if (filters.blockchain) {
      const chain = (pair.chain || pair.chainId || '').toString().toLowerCase();
      const filterChain = filters.blockchain.toString().toLowerCase();
      passes = passes && chain.includes(filterChain);
    }
    return passes;
  });

  if (filteredPairs.length === 0) {
    bot.sendMessage(chatId, 'No tokens found matching your filters.');
    return;
  }

  // For each token, send details and a trade button
  for (const pair of filteredPairs) {
    const chain = pair.chain || pair.chainId || 'Unknown';
    bot.sendMessage(
      chatId,
      `Token: ${pair.baseToken.name} (${pair.baseToken.symbol})\nBlockchain: ${chain}\nDEX: ${pair.dexId}\nPrice: $${pair.priceUsd}\nFDV: $${pair.fdv}\nLiquidity: $${pair.liquidity && pair.liquidity.usd}\nCA: ${pair.baseToken.address}`,
      { reply_markup: { inline_keyboard: [[{ text: `Trade ${pair.baseToken.name} (${pair.baseToken.symbol})`, callback_data: `trade_token_${pair.baseToken.address}` }]] } }
    );
  }

  // Store a mapping from address to pair for this user for quick lookup
  userFilters[chatId] = userFilters[chatId] || {};
  userFilters[chatId].lastTokenPairs = filteredPairs.reduce((acc, pair) => {
    acc[pair.baseToken.address] = pair;
    return acc;
  }, {});
});

bot.on('callback_query', (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('set_filter_')) {
    const filterKey = data.replace('set_filter_', '');
    if (filterKey === 'done') {
      // Show summary and finish
      const filters = userFilters[chatId].filters || {};
      let summary = 'Your filters:\n';
      for (const [key, value] of Object.entries(filters)) {
        summary += `${key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`;
      }
      bot.sendMessage(chatId, summary + "\nYou can now use /checktoken to search with these filters.");
      return;
    }
    if (filterKey === 'blockchain') {
      bot.sendMessage(chatId, 'Please select a blockchain:', { reply_markup: getBlockchainButtons().inline_keyboard ? getBlockchainButtons() : { inline_keyboard: getBlockchainButtons() } });
      return;
    }
    if (['fdv', 'liquidity', 'volumeBuy', 'volumeSell'].includes(filterKey)) {
      bot.sendMessage(chatId, `Choose a value for ${filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:`, getNumericFilterButtons(filterKey));
      return;
    }
    if (filterKey === 'back') {
      const filterButtons = getFilterButtons(userFilters[chatId].filters || {});
      bot.sendMessage(chatId, "Please set your preferred filters. Tap a filter to set its value. You can change them anytime by sending /checkfilter again.",
        { reply_markup: { inline_keyboard: filterButtons } }
      );
      return;
    }
    userFilters[chatId].awaitingFilterKey = filterKey;
    bot.sendMessage(chatId, `Please enter the value for ${filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:`);
  } else if (data.startsWith('choose_chain_')) {
    const chain = data.replace('choose_chain_', '');
    userFilters[chatId].filters = userFilters[chatId].filters || {};
    userFilters[chatId].filters.blockchain = chain;
    const filterButtons = getFilterButtons(userFilters[chatId].filters);
    bot.sendMessage(chatId, `Blockchain set to ${chain}. You can set another filter or tap Done.`,
      { reply_markup: { inline_keyboard: filterButtons } }
    );
  } else if (data.startsWith('numfilter_')) {
    // Handle numeric filter button selection
    const [ , filterKey, op, valueOrCustom ] = data.split('_');
    userFilters[chatId].filters = userFilters[chatId].filters || {};
    if (op === 'custom') {
      userFilters[chatId].awaitingCustomRange = filterKey;
      bot.sendMessage(chatId, `Please enter your custom range for ${filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} in the format: min 10000 max 50000`);
    } else {
      userFilters[chatId].filters[filterKey] = { op: op === 'gt' ? '>' : '<', value: parseFloat(valueOrCustom) };
      const filterButtons = getFilterButtons(userFilters[chatId].filters);
      bot.sendMessage(chatId, `${filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} set to ${op === 'gt' ? '>' : '<'}${valueOrCustom}. You can set another filter or tap Done.`,
        { reply_markup: { inline_keyboard: filterButtons } }
      );
    }
  } else if (data.startsWith('trade_token_')) {
    const address = data.replace('trade_token_', '');
    const pair = userFilters[chatId] && userFilters[chatId].lastTokenPairs ? userFilters[chatId].lastTokenPairs[address] : null;
    if (pair) {
      bot.sendMessage(
        chatId,
        `Token: ${pair.baseToken.name} (${pair.baseToken.symbol})\nDEX: ${pair.dexId}\nPrice: $${pair.priceUsd}\nFDV: $${pair.fdv}\nLiquidity: $${pair.liquidity && pair.liquidity.usd}\nCA: ${pair.baseToken.address}`,
        { reply_markup: { inline_keyboard: getTradingBotButtons(pair.baseToken.address) } }
      );
    } else {
      bot.sendMessage(chatId, 'Token not found. Please try /checktoken again.');
    }
    return;
  }
});

bot.onText(/\/saveword(?:\\s*(.*))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1] ? match[1].trim() : '';
  if (!input) {
    bot.sendMessage(chatId, 'Please add your words after the command, e.g. /saveword nothing hope moon');
    return;
  }
  const inputWords = input.split(/\\s+/).map(w => w.trim().toLowerCase()).filter(Boolean);
  if (inputWords.length === 0) {
    bot.sendMessage(chatId, 'Please provide at least one word to save.');
    return;
  }
  if (inputWords.length > 5) {
    bot.sendMessage(chatId, 'You can only save up to 5 words.');
    return;
  }
  userSavedWords[chatId] = inputWords;
  bot.sendMessage(chatId, `Saved words: ${inputWords.join(', ')}\\nYou will be notified when a token matching any of these words launches.`);
});

bot.onText(/\/mysavedwords/, (msg) => {
  const chatId = msg.chat.id;
  const words = userSavedWords[chatId];
  if (words && words.length > 0) {
    bot.sendMessage(chatId, `Your saved words: ${words.join(', ')}`);
  } else {
    bot.sendMessage(chatId, 'You have not saved any words yet. Use /saveword <word1> <word2> ... to save up to 5 words.');
  }
});

bot.onText(/\/clearsavedwords/, (msg) => {
  const chatId = msg.chat.id;
  userSavedWords[chatId] = [];
  bot.sendMessage(chatId, 'Your saved words have been cleared.');
});

// Helper: fetch latest tokens from Dexscreener (top 100 pairs from trending endpoint)
async function fetchLatestTokens() {
  try {
    const response = await axios.get('https://api.dexscreener.com/latest/dex/tokens');
    // This endpoint returns a list of tokens (not pairs)
    return response.data.tokens || [];
  } catch (error) {
    console.error('Error fetching latest tokens:', error);
    return [];
  }
}

// Helper: check for new tokens matching saved words
async function checkForTokenAlerts() {
  const tokens = await fetchLatestTokens();
  if (!tokens.length) return;

  for (const [userId, words] of Object.entries(userSavedWords)) {
    if (!words || words.length === 0) continue;
    // Allow duplicates: do not track alreadyNotified
    for (const token of tokens) {
      const name = (token.name || '').toLowerCase();
      const symbol = (token.symbol || '').toLowerCase();
      const address = token.address;
      // If any saved word matches name or symbol, notify
      if (words.some(word => name.includes(word) || symbol.includes(word))) {
        if (address && typeof address === 'string' && address.length > 0) {
          bot.sendMessage(
            userId,
            `🚨 New token launched matching your saved word!\n\nToken: ${token.name} (${token.symbol})\nCA: ${address}\nDEX: ${token.dexId || 'N/A'}\nPrice: $${token.priceUsd || 'N/A'}`,
            { reply_markup: { inline_keyboard: getTradingBotButtons(address) } }
          );
        } else {
          bot.sendMessage(
            userId,
            `🚨 New token launched matching your saved word!\n\nToken: ${token.name} (${token.symbol})\nCA: N/A\nDEX: ${token.dexId || 'N/A'}\nPrice: $${token.priceUsd || 'N/A'}`
          );
        }
      }
    }
  }
}

// Check every 5 minutes (300,000 ms)
setInterval(checkForTokenAlerts, 300000);

function getTradingBotButtons(tokenAddress) {
  return [
    [
      { text: 'Trade on Maestro', url: `https://t.me/MaestroSniperBot?start=${tokenAddress}` }
    ],
    [
      { text: 'Trade on Trojan', url: `https://t.me/TrojanBot?start=${tokenAddress}` }
    ],
    [
      { text: 'Trade on SolTradingBot', url: `https://t.me/SolTradingBot?start=${tokenAddress}` }
    ]
  ];
}

// Update filtering logic in /checktoken
function passesNumericFilter(pairValue, filter) {
  if (typeof filter === 'object') {
    if (filter.min !== undefined && filter.max !== undefined) {
      return pairValue >= filter.min && pairValue <= filter.max;
    }
    if (filter.op && filter.value !== undefined) {
      if (filter.op === '>') return pairValue > filter.value;
      if (filter.op === '<') return pairValue < filter.value;
    }
  }
  return true;
}