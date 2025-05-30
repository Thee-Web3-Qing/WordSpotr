require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;
const axios = require('axios');
const fuzz = require('fuzzball');
const express = require('express'); // Added for Render port binding

console.log("🚀 Starting WordSpotr bot...");

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userFilters = {};
const userSavedWords = {};
const notifiedTokens = {};
const TOKENS_PER_PAGE = 5;

// Utility function to escape MarkdownV2 special characters
function escapeMarkdownV2(text) {
  const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  return text.replace(new RegExp(`([${specialChars.map(c => '\\' + c).join('')}\])`, 'g'), '\\$1');
}

// Enhanced welcome message with better formatting
function getWelcomeMessage() {
  return `🎯 *Welcome to WordSpotr Bot\\!*

*Your AI\\-Powered Token Discovery Assistant*

✨ *What I can do for you:*
• 🔍 Search tokens by phrase using /checktoken
• ⚙️ Set smart trading filters with /checkfilter  
• 💾 Save up to 5 words for instant alerts with /saveword
• 🚨 Get real\\-time notifications for new token launches
• 📊 Advanced filtering by market cap, liquidity & more

*Quick Start Commands:*
/start \\- Show this welcome message
/checktoken \\<your phrase\\> \\- Find tokens instantly
/checkfilter \\- Configure your trading preferences
/saveword \\<words\\> \\- Set up launch alerts
/help \\- Get detailed help

_Ready to discover your next gem?_ 💎`;
}

// Enhanced help message with better structure
function getHelpMessage() {
  return `📚 *WordSpotr Bot Help Guide*

*🔍 SEARCH TOKENS*
\`/checktoken nothing will be forgiven\`
• Searches for tokens matching your phrase
• Uses AI to find semantic matches
• Applies your saved filters automatically
• Navigate results with pagination

*⚙️ CONFIGURE FILTERS*
\`/checkfilter\`
• Set market cap thresholds
• Configure liquidity requirements
• Filter by blockchain (SOL, ETH, BNB, TON)
• Set volume buy/sell limits

*💾 WORD ALERTS*
\`/saveword moon pepe hope rocket doge\`
• Save up to 5 trigger words
• Get instant alerts for new launches
• Automatic matching on token names/symbols

*📊 MANAGE YOUR SETUP*
\`/mysavedwords\` \\- View saved words
\`/clearsavedwords\` \\- Reset word list
\`/mystats\` \\- View your activity

*💡 Pro Tips:*
• Use specific phrases for better results
• Set realistic filters to avoid missing gems
• Combine multiple search terms for precision
• Use Next/Previous buttons to browse results

Need more help? Contact @WordSpotrSupport`;
}

// Enhanced button layouts with better organization
function getMainMenuButtons() {
  return {
    inline_keyboard: [
      [
        { text: '🔍 Search Tokens', callback_data: 'menu_search' },
        { text: '⚙️ Set Filters', callback_data: 'menu_filters' }
      ],
      [
        { text: '💾 Manage Words', callback_data: 'menu_words' },
        { text: '📊 My Stats', callback_data: 'menu_stats' }
      ],
      [
        { text: '📚 Help Guide', callback_data: 'menu_help' },
        { text: '💬 Support', url: 'https://t.me/WordSpotrSupport' }
      ]
    ]
  };
}

function getFilterButtons(filters) {
  const hasFilters = Object.keys(filters).length > 0;
  return [
    [
      { 
        text: `💰 Market Cap ${filters.fdv ? `(${escapeMarkdownV2(`$${formatNumber(filters.fdv)}`)})` : ''}`, 
        callback_data: 'set_filter_fdv' 
      }
    ],
    [
      { 
        text: `💧 Liquidity ${filters.liquidity ? `(${escapeMarkdownV2(`$${formatNumber(filters.liquidity)}`)})` : ''}`, 
        callback_data: 'set_filter_liquidity' 
      }
    ],
    [
      { 
        text: `📈 Volume Buy ${filters.volumeBuy ? `(${escapeMarkdownV2(`$${formatNumber(filters.volumeBuy)}`)})` : ''}`, 
        callback_data: 'set_filter_volumeBuy' 
      },
      { 
        text: `📉 Volume Sell ${filters.volumeSell ? `(${escapeMarkdownV2(`$${formatNumber(filters.volumeSell)}`)})` : ''}`, 
        callback_data: 'set_filter_volumeSell' 
      }
    ],
    [
      { 
        text: `⛓️ Blockchain ${filters.blockchain ? `(${escapeMarkdownV2(filters.blockchain)})` : ''}`, 
        callback_data: 'set_filter_blockchain' 
      }
    ],
    [
      { text: hasFilters ? '🗑️ Clear All' : '❌ Cancel', callback_data: hasFilters ? 'clear_all_filters' : 'menu_main' },
      { text: '✅ Done', callback_data: 'set_filter_done' }
    ]
  ];
}

function getBlockchainButtons() {
  return {
    inline_keyboard: [
      [
        { text: '☀️ Solana', callback_data: 'choose_chain_SOL' },
        { text: '⚡ BNB Chain', callback_data: 'choose_chain_BNB' }
      ],
      [
        { text: '💎 Ethereum', callback_data: 'choose_chain_ETH' },
        { text: '🔷 TON', callback_data: 'choose_chain_TON' }
      ],
      [
        { text: '◀️ Back', callback_data: 'set_filter_back' }
      ]
    ]
  };
}

function getNumericFilterButtons(filterKey) {
  const emojis = {
    fdv: '💰',
    liquidity: '💧',
    volumeBuy: '📈',
    volumeSell: '📉'
  };
  
  return {
    inline_keyboard: [
      [
        { text: `${emojis[filterKey]} > $10K`, callback_data: `numfilter_${filterKey}_gt_10000` },
        { text: `${emojis[filterKey]} > $50K`, callback_data: `numfilter_${filterKey}_gt_50000` }
      ],
      [
        { text: `${emojis[filterKey]} < $10K`, callback_data: `numfilter_${filterKey}_lt_10000` },
        { text: `${emojis[filterKey]} < $50K`, callback_data: `numfilter_${filterKey}_lt_50000` }
      ],
      [
        { text: '🎯 Custom Range', callback_data: `numfilter_${filterKey}_custom` }
      ],
      [
        { text: '◀️ Back', callback_data: 'set_filter_back' }
      ]
    ]
  };
}

function getTradingBotButtons(tokenAddress, tokenName = '', tokenSymbol = '') {
  return [
    [
      { text: `🎯 Trade ${escapeMarkdownV2(tokenSymbol)} on Maestro`, url: `https://t.me/MaestroSniperBot?start=${tokenAddress}` }
    ],
    [
      { text: `⚡ Trade ${escapeMarkdownV2(tokenSymbol)} on Trojan`, url: `https://t.me/TrojanBot?start=${tokenAddress}` }
    ],
    [
      { text: `☀️ Trade ${escapeMarkdownV2(tokenSymbol)} on SolTradingBot`, url: `https://t.me/SolTradingBot?start=${tokenAddress}` }
    ],
    [
      { text: '📊 View on DexScreener', url: `https://dexscreener.com/search?q=${tokenAddress}` }
    ]
  ];
}

// Utility functions for better formatting
function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatTokenMessage(pair, index, total) {
  const chain = pair.chain || pair.chainId || 'Unknown';
  const chainEmoji = {
    'solana': '☀️',
    'ethereum': '💎',
    'bsc': '⚡',
    'ton': '🔷'
  };
  
  const emoji = chainEmoji[chain.toLowerCase()] || '⛓️';
  const price = pair.priceUsd ? `$${parseFloat(pair.priceUsd).toFixed(8)}` : 'N/A';
  const fdv = pair.fdv ? `$${formatNumber(pair.fdv)}` : 'N/A';
  const liquidity = pair.liquidity?.usd ? `$${formatNumber(pair.liquidity.usd)}` : 'N/A';
  
  return `🎯 *Token ${index}/${total}*

💎 *${escapeMarkdownV2(pair.baseToken.name)}* \\(${escapeMarkdownV2(pair.baseToken.symbol)}\\)
${emoji} *Chain:* ${escapeMarkdownV2(chain)}
🏪 *DEX:* ${escapeMarkdownV2(pair.dexId)}
💰 *Price:* \`${escapeMarkdownV2(price)}\`
📊 *Market Cap:* \`${escapeMarkdownV2(fdv)}\`
💧 *Liquidity:* \`${escapeMarkdownV2(liquidity)}\`
📋 *CA:* \`${escapeMarkdownV2(pair.baseToken.address)}\``;
}

// Set up enhanced commands
bot.setMyCommands([
  { command: 'start', description: '🚀 Start & see main menu' },
  { command: 'checktoken', description: '🔍 Search tokens by phrase' },
  { command: 'checkfilter', description: '⚙️ Configure trading filters' },
  { command: 'saveword', description: '💾 Save words for alerts' },
  { command: 'mysavedwords', description: '📝 View saved words' },
  { command: 'clearsavedwords', description: '🗑️ Clear all saved words' },
  { command: 'mystats', description: '📊 View your statistics' },
  { command: 'help', description: '📚 Detailed help guide' }
]);

// Enhanced command handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name;
  
  bot.sendMessage(chatId, getWelcomeMessage(), {
    parse_mode: 'MarkdownV2',
    reply_markup: getMainMenuButtons()
  });
  
  setTimeout(() => {
    bot.sendMessage(chatId, `💡 *Quick Tip, ${escapeMarkdownV2(firstName)}\\!*\n\nTry: \`/checktoken moon rocket doge\` to see the magic in action\\! ✨`, {
      parse_mode: 'MarkdownV2'
    });
  }, 2000);
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, getHelpMessage(), {
    parse_mode: 'MarkdownV2',
    reply_markup: getMainMenuButtons()
  });
});

bot.onText(/\/mystats/, (msg) => {
  const chatId = msg.chat.id;
  const filters = userFilters[chatId]?.filters || {};
  const savedWords = userSavedWords[chatId] || [];
  
  const statsMessage = `📊 *Your WordSpotr Statistics*

👤 *User:* ${escapeMarkdownV2(msg.from.first_name)}
🆔 *Chat ID:* \`${chatId}\`

⚙️ *Active Filters:* ${Object.keys(filters).length}
💾 *Saved Words:* ${savedWords.length}/5
🚨 *Alert Status:* ${savedWords.length > 0 ? '✅ Active' : '❌ Inactive'}

*Recent Activity:*
• Last search: ${escapeMarkdownV2(userFilters[chatId]?.lastSearch || 'Never')}
• Tokens found today: ${userFilters[chatId]?.tokensFoundToday || 0}
• Alerts received: ${userFilters[chatId]?.alertsReceived || 0}

_Keep searching to discover more gems\\!_ 💎`;

  bot.sendMessage(chatId, statsMessage, {
    parse_mode: 'MarkdownV2',
    reply_markup: getMainMenuButtons()
  });
});

bot.onText(/\/checkfilter/, (msg) => {
  const chatId = msg.chat.id;
  userFilters[chatId] = userFilters[chatId] || { filters: {} };
  userFilters[chatId].awaitingFilterKey = null;

  const filterButtons = getFilterButtons(userFilters[chatId].filters || {});
  const hasFilters = Object.keys(userFilters[chatId].filters || {}).length > 0;

  bot.sendMessage(chatId,
    `⚙️ *Configure Your Trading Filters*\n\n${hasFilters ? 'Current filters are applied to all searches\\.' : 'No filters set\\. Set filters to refine your token searches\\.'}\n\n*Tap a filter to configure:*`,
    { 
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: filterButtons } 
    }
  );
});

// Enhanced token search with pagination
bot.onText(/\/checktoken(?:\s+([\s\S]+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1] ? match[1].trim() : '';
  
  if (!input) {
    bot.sendMessage(chatId, 
      `🔍 *Token Search*\n\nPlease add your search phrase after the command\\.\n\n*Example:*\n\`/checktoken nothing will be forgiven\`\n\`/checktoken moon rocket doge\``, 
      { 
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '💡 See Examples', callback_data: 'show_search_examples' },
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      }
    );
    return;
  }

  // Show searching animation
  let searchingMsg;
  try {
    searchingMsg = await bot.sendMessage(chatId, 
      `🔍 *Searching for tokens\\.\\.\\.*\n\nAnalyzing: \`${escapeMarkdownV2(input)}\`\n\n⏳ Please wait\\.\\.\\. This may take a few seconds`, 
      { parse_mode: 'MarkdownV2' }
    );
  } catch (error) {
    console.error('Error sending searching message:', error);
    return;
  }

  try {
    const parts = input.split(/\s+/);
    const filterParts = parts.filter(p => p.includes('>') || p.includes('<') || p.includes('='));
    const sentenceParts = parts.filter(p => !filterParts.includes(p));
    const sentence = sentenceParts.join(' ');

    let filters = {};
    filterParts.forEach(f => {
      const match = f.match(/(fdv|liquidity|price|volume)([<>=]+)(\d+(\.\d+)?)/i);
      if (match) {
        const [, key, op, value] = match;
        filters[key.toLowerCase()] = { op, value: parseFloat(value) };
      }
    });

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
        console.error('API Error:', error);
      }
    }

    // Remove duplicates
    const uniquePairs = [];
    const seenAddresses = new Set();
    for (const pair of allPairs) {
      if (pair.baseToken && pair.baseToken.address && !seenAddresses.has(pair.baseToken.address)) {
        uniquePairs.push(pair);
        seenAddresses.add(pair.baseToken.address);
      }
    }

    // Delete searching message
    try {
      await bot.deleteMessage(chatId, searchingMsg.message_id);
    } catch (error) {
      console.error('Error deleting searching message:', error);
    }

    if (uniquePairs.length === 0) {
      bot.sendMessage(chatId, 
        `❌ *No Tokens Found*\n\nNo tokens match your search: \`${escapeMarkdownV2(input)}\`\n\n💡 *Try:*\n• Different keywords\n• Broader search terms\n• Check spelling`, 
        { 
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              { text: '🔍 Try Again', callback_data: 'menu_search' },
              { text: '◶ Main Menu', callback_data: 'menu_main' }
            ]]
          }
        }
      );
      return;
    }

    // Apply filters
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
      bot.sendMessage(chatId, 
        `🔍 *Search Results*\n\nFound ${uniquePairs.length} tokens, but none match your filters\\.\n\n💡 *Consider:*\n• Adjusting your filters\n• Using /checkfilter to modify settings`, 
        { 
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              { text: '⚙️ Adjust Filters', callback_data: 'menu_filters' },
              { text: '🔍 Search Again', callback_data: 'menu_search' }
            ]]
          }
        }
      );
      return;
    }

    // Store results for pagination
    userFilters[chatId] = userFilters[chatId] || {};
    userFilters[chatId].lastTokenPairs = filteredPairs;
    userFilters[chatId].lastSearch = input;
    userFilters[chatId].tokensFoundToday = (userFilters[chatId].tokensFoundToday || 0) + filteredPairs.length;
    userFilters[chatId].currentPage = 1;
    userFilters[chatId].pageMessageIds = []; // Initialize array to track page message IDs

    // Send first page of results
    await sendTokenPage(chatId, filteredPairs, 1, input);

  } catch (error) {
    console.error('Search Error:', error);
    try {
      await bot.deleteMessage(chatId, searchingMsg.message_id);
    } catch (deleteError) {
      console.error('Error deleting searching message in catch block:', deleteError);
    }
    bot.sendMessage(chatId, 
      `❌ *Search Error*\n\nSomething went wrong with your search\\. Please try again\\.\n\nIf the problem persists, contact support\\.`, 
      { 
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔄 Try Again', callback_data: 'menu_search' },
            { text: '💬 Support', url: 'https://t.me/WordSpotrSupport' }
          ]]
        }
      }
    );
  }
});

// New function to send paginated token results
async function sendTokenPage(chatId, pairs, page, searchQuery) {
  const totalPages = Math.ceil(pairs.length / TOKENS_PER_PAGE);
  const startIndex = (page - 1) * TOKENS_PER_PAGE;
  const endIndex = Math.min(startIndex + TOKENS_PER_PAGE, pairs.length);
  const pagePairs = pairs.slice(startIndex, endIndex);

  // Store message IDs for this page
  const messageIds = [];

  // Send results header
  const headerMessage = `✅ *Search Complete\\!*\n\nFound *${pairs.length}* tokens matching: \`${escapeMarkdownV2(searchQuery)}\`\n\n📊 Showing page *${page}/${totalPages}* \\(${pagePairs.length} tokens\\)`;
  const headerMsg = await bot.sendMessage(chatId, headerMessage, { parse_mode: 'MarkdownV2' });
  messageIds.push(headerMsg.message_id);

  // Send each token on this page
  for (let i = 0; i < pagePairs.length; i++) {
    const pair = pagePairs[i];
    const globalIndex = startIndex + i + 1;
    const tokenMessage = formatTokenMessage(pair, globalIndex, pairs.length);
    
    const tokenMsg = await bot.sendMessage(chatId, tokenMessage, {
      parse_mode: 'MarkdownV2',
      reply_markup: { 
        inline_keyboard: getTradingBotButtons(pair.baseToken.address, pair.baseToken.name, pair.baseToken.symbol) 
      }
    });
    messageIds.push(tokenMsg.message_id);
    
    // Small delay between messages to avoid rate limits
    if (i < pagePairs.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Add pagination controls
  const paginationButtons = [];
  if (page > 1) {
    paginationButtons.push({ text: '◀️ Previous', callback_data: `page_${page - 1}` });
  }
  if (page < totalPages) {
    paginationButtons.push({ text: 'Next ▶️', callback_data: `page_${page + 1}` });
  }
  paginationButtons.push({ text: '◶ Main Menu', callback_data: 'menu_main' });

  if (paginationButtons.length > 1) {
    const paginationMsg = await bot.sendMessage(chatId, `📄 *Page ${page}/${totalPages}*`, {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [paginationButtons]
      }
    });
    messageIds.push(paginationMsg.message_id);
  }

  // Store message IDs for the current page
  userFilters[chatId].pageMessageIds = messageIds;
}

// Enhanced callback query handler with pagination
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  // Answer callback to remove loading state
  bot.answerCallbackQuery(callbackQuery.id);

  // Handle pagination
  if (data.startsWith('page_')) {
    const page = parseInt(data.split('_')[1]);
    const pairs = userFilters[chatId]?.lastTokenPairs || [];
    
    if (pairs.length === 0) {
      bot.editMessageText('❌ *No Results Available*\n\nPlease perform a new search using /checktoken', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔍 New Search', callback_data: 'menu_search' },
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      });
      return;
    }

    // Delete all messages from the current page
    const messageIds = userFilters[chatId]?.pageMessageIds || [];
    for (const msgId of messageIds) {
      try {
        await bot.deleteMessage(chatId, msgId);
      } catch (error) {
        console.error(`Error deleting message ${msgId}:`, error);
      }
    }

    userFilters[chatId].currentPage = page;
    await sendTokenPage(chatId, pairs, page, userFilters[chatId]?.lastSearch || 'your query');
    return;
  }

  // Main menu navigation
  if (data === 'menu_main') {
    bot.editMessageText('🎯 *WordSpotr Main Menu*\n\nChoose an option below:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'MarkdownV2',
      reply_markup: getMainMenuButtons()
    });
    return;
  }

  if (data === 'menu_search') {
    bot.editMessageText('🔍 *Token Search*\n\nUse the command: `/checktoken <your phrase>`\n\n*Examples:*\n• `/checktoken moon rocket`\n• `/checktoken nothing will be forgiven`\n• `/checktoken pepe doge meme`', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '◶ Back', callback_data: 'menu_main' }
        ]]
      }
    });
    return;
  }

  if (data === 'menu_filters') {
    userFilters[chatId] = userFilters[chatId] || { filters: {} };
    const filterButtons = getFilterButtons(userFilters[chatId].filters || {});
    bot.editMessageText('⚙️ *Configure Trading Filters*\n\nSet your preferences to refine token searches:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: filterButtons }
    });
    return;
  }

  if (data === 'show_search_examples') {
    bot.editMessageText('🔍 *Token Search Examples*\n\nTry these commands:\n• `/checktoken moon rocket`\n• `/checktoken nothing will be forgiven`\n• `/checktoken pepe doge meme`\n\nUse Next/Previous buttons to navigate results.', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '◶ Back', callback_data: 'menu_search' },
          { text: '◶ Main Menu', callback_data: 'menu_main' }
        ]]
      }
    });
    return;
  }

  if (data.startsWith('set_filter_')) {
    const filterKey = data.replace('set_filter_', '');
    
    if (filterKey === 'done') {
      const filters = userFilters[chatId].filters || {};
      let summary = '✅ *Filters Configured*\n\n';
      
      if (Object.keys(filters).length === 0) {
        summary += 'No filters set\\. All tokens will be shown in searches\\.';
      } else {
        summary += '*Active Filters:*\n';
        for (const [key, value] of Object.entries(filters)) {
          const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
          const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
          summary += `• ${displayKey}: \`${escapeMarkdownV2(displayValue)}\`\n`;
        }
      }
      
      bot.editMessageText(summary, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔍 Search Tokens', callback_data: 'menu_search' },
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      });
      return;
    }
    
    if (filterKey === 'blockchain') {
      bot.editMessageText('⛓️ *Select Blockchain*\n\nChoose your preferred blockchain:', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: getBlockchainButtons()
      });
      return;
    }
    
    if (['fdv', 'liquidity', 'volumeBuy', 'volumeSell'].includes(filterKey)) {
      const displayName = filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      bot.editMessageText(`💰 *Set ${escapeMarkdownV2(displayName)} Filter*\n\nChoose a preset or set custom range:`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: getNumericFilterButtons(filterKey)
      });
      return;
    }
    
    if (filterKey === 'back') {
      const filterButtons = getFilterButtons(userFilters[chatId].filters || {});
      bot.editMessageText('⚙️ *Configure Trading Filters*\n\nSet your preferences to refine token searches:', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: filterButtons }
      });
      return;
    }
  }

  if (data.startsWith('choose_chain_')) {
    const chain = data.replace('choose_chain_', '');
    userFilters[chatId].filters = userFilters[chatId].filters || {};
    userFilters[chatId].filters.blockchain = chain;
    
    const filterButtons = getFilterButtons(userFilters[chatId].filters);
    bot.editMessageText(`✅ *Blockchain Set*\n\nSelected: ${escapeMarkdownV2(chain)}\n\nConfigure more filters or tap Done:`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: filterButtons }
    });
    return;
  }

  if (data.startsWith('numfilter_')) {
    const [, filterKey, op, valueOrCustom] = data.split('_');
    userFilters[chatId].filters = userFilters[chatId].filters || {};
    
    if (op === 'custom') {
      userFilters[chatId].awaitingCustomRange = filterKey;
      bot.editMessageText(`🎯 *Custom Range for ${escapeMarkdownV2(filterKey.replace(/([A-Z])/g, ' $1'))}*\n\nSend a message with format:\n\`min 10000 max 50000\``, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '❌ Cancel', callback_data: 'set_filter_back' }
          ]]
        }
      });
      return;
    } else {
      userFilters[chatId].filters[filterKey] = { 
        op: op === 'gt' ? '>' : '<', 
        value: parseFloat(valueOrCustom) 
      };
      
      const filterButtons = getFilterButtons(userFilters[chatId].filters);
      const displayName = filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      bot.editMessageText(`✅ *Filter Set*\n\n${escapeMarkdownV2(displayName)}: ${op === 'gt' ? '>' : '<'}$${formatNumber(parseFloat(valueOrCustom))}\n\nConfigure more or tap Done:`, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: filterButtons }
      });
    }
    return;
  }

  if (data === 'clear_all_filters') {
    userFilters[chatId].filters = {};
    const filterButtons = getFilterButtons({});
    bot.editMessageText('🗑️ *All Filters Cleared*\n\nYour filters have been reset\\. Configure new ones:', {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: filterButtons }
    });
    return;
  }

  if (data === 'view_saved_words') {
    const words = userSavedWords[chatId] || [];
    if (words.length > 0) {
      bot.editMessageText(
        `📝 *Your Saved Words*\n\n${words.map((w, i) => `${i + 1}\\. \`${escapeMarkdownV2(w)}\``).join('\n')}\n\n*Status:* 🟢 Active alerts\n*Slots used:* ${words.length}/5`, 
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              { text: '➕ Add More', callback_data: 'add_more_words' },
              { text: '🗑️ Clear All', callback_data: 'clear_saved_words' }
            ], [
              { text: '◶ Main Menu', callback_data: 'menu_main' }
            ]]
          }
        }
      );
    } else {
      bot.editMessageText(
        `📝 *Your Saved Words*\n\n❌ No words saved yet\\. Use \`/saveword <word1> <word2> \\.\\.\\.\` to save up to 5 words for launch alerts\\.`, 
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              { text: '💾 Save Words Now', callback_data: 'save_words_help' },
              { text: '◶ Main Menu', callback_data: 'menu_main' }
            ]]
          }
        }
      );
    }
    return;
  }

  if (data === 'add_more_words' || data === 'save_words_help') {
    bot.editMessageText(
      `💾 *How to Save Alert Words*\n\n*Command:* \`/saveword <word1> <word2> \\.\\.\\.\`\n\n*Examples:*\n• \`/saveword moon rocket\`\n• \`/saveword pepe doge meme coin\`\n• \`/saveword hope nothing forgiven\`\n\n*Rules:*\n• Maximum 5 words\n• Words are case\\-insensitive\n• Matches token names and symbols`, 
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '◶ Back', callback_data: 'menu_main' }
          ]]
        }
      }
    );
    return;
  }

  if (data === 'clear_saved_words') {
    const words = userSavedWords[chatId] || [];
    if (words.length === 0) {
      bot.editMessageText(
        `🗑️ *Clear Saved Words*\n\nYou don't have any saved words to clear\\.`, 
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              { text: '◶ Main Menu', callback_data: 'menu_main' }
            ]]
          }
        }
      );
    } else {
      bot.editMessageText(
        `🗑️ *Clear All Saved Words?*\n\nThis will remove all ${words.length} saved words:\n${words.map(w => `• \`${escapeMarkdownV2(w)}\``).join('\n')}\n\n⚠️ *This action cannot be undone\\!*`, 
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Yes, Clear All', callback_data: 'confirm_clear_words' },
              { text: '❌ Cancel', callback_data: 'menu_main' }
            ]]
          }
        }
      );
    }
    return;
  }

  if (data === 'confirm_clear_words') {
    userSavedWords[chatId] = [];
    bot.editMessageText(
      `✅ *Words Cleared*\n\nAll your saved words have been removed\\.\n\nYou can add new words anytime with \`/saveword\`\\.`, 
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '💾 Save New Words', callback_data: 'save_words_help' },
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      }
    );
    return;
  }

  if (data === 'menu_words') {
    bot.editMessageText(
      `💾 *Manage Your Alert Words*\n\nChoose an action:`, 
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '📝 View Saved Words', callback_data: 'view_saved_words' },
            { text: '➕ Add Words', callback_data: 'save_words_help' }
          ], [
            { text: '🗑️ Clear Words', callback_data: 'clear_saved_words' },
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      }
    );
    return;
  }

  if (data === 'menu_stats') {
    const filters = userFilters[chatId]?.filters || {};
    const savedWords = userSavedWords[chatId] || [];
    const statsMessage = `📊 *Your WordSpotr Statistics*

👤 *User:* ${escapeMarkdownV2(callbackQuery.from.first_name)}
🆔 *Chat ID:* \`${chatId}\`

⚙️ *Active Filters:* ${Object.keys(filters).length}
💾 *Saved Words:* ${savedWords.length}/5
🚨 *Alert Status:* ${savedWords.length > 0 ? '✅ Active' : '❌ Inactive'}

*Recent Activity:*
• Last search: ${escapeMarkdownV2(userFilters[chatId]?.lastSearch || 'Never')}
• Tokens found today: ${userFilters[chatId]?.tokensFoundToday || 0}
• Alerts received: ${userFilters[chatId]?.alertsReceived || 0}

_Keep searching to discover more gems\\!_ 💎`;

    bot.editMessageText(statsMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'MarkdownV2',
      reply_markup: getMainMenuButtons()
    });
    return;
  }
});

// Enhanced message handling for filter inputs
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  
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
      const displayName = filterKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      
      bot.sendMessage(chatId, 
        `✅ *Custom Range Set*\n\n${escapeMarkdownV2(displayName)}: ${formatNumber(min)} - ${formatNumber(max)}\n\nConfigure more filters or tap Done:`, {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: filterButtons }
      });
    } else {
      bot.sendMessage(chatId, 
        `❌ *Invalid Format*\n\nPlease use: \`min 10000 max 50000\`\n\nTry again:`, 
        { parse_mode: 'MarkdownV2' }
      );
    }
    return;
  }
});

// Enhanced word management commands
bot.onText(/\/saveword(?:\s*(.*))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const input = match[1] ? match[1].trim() : '';
  
  if (!input) {
    bot.sendMessage(chatId, 
      `💾 *Save Alert Words*\n\nAdd up to 5 words to get notified when matching tokens launch\\.\n\n*Example:*\n\`/saveword moon rocket pepe doge hope\`\n\n*Current saved words:* ${(userSavedWords[chatId] || []).length}/5`, 
      { 
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '📝 View My Words', callback_data: 'view_saved_words' },
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      }
    );
    return;
  }
  
  const inputWords = input.split(/\s+/).map(w => w.trim().toLowerCase()).filter(Boolean);
  
  if (inputWords.length === 0) {
    bot.sendMessage(chatId, 
      `❌ *No Valid Words*\n\nPlease provide at least one word to save\\.`, 
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }
  
  if (inputWords.length > 5) {
    bot.sendMessage(chatId, 
      `❌ *Too Many Words*\n\nYou can only save up to 5 words\\. You provided ${inputWords.length}\\.\n\n*Try again with fewer words\\.*`, 
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }
  
  userSavedWords[chatId] = inputWords;
  
  bot.sendMessage(chatId, 
    `✅ *Words Saved Successfully\\!*\n\n💾 *Your alert words:*\n${inputWords.map(w => `• \`${escapeMarkdownV2(w)}\``).join('\n')}\n\n🚨 You'll be notified when tokens matching these words launch\\!`, 
    { 
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '🔍 Search Now', callback_data: 'menu_search' },
          { text: '◶ Main Menu', callback_data: 'menu_main' }
        ]]
      }
    }
  );
});

bot.onText(/\/mysavedwords/, (msg) => {
  const chatId = msg.chat.id;
  const words = userSavedWords[chatId];
  
  if (words && words.length > 0) {
    bot.sendMessage(chatId, 
      `📝 *Your Saved Words*\n\n${words.map((w, i) => `${i + 1}\\. \`${escapeMarkdownV2(w)}\``).join('\n')}\n\n*Status:* 🟢 Active alerts\n*Slots used:* ${words.length}/5`, 
      { 
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '➕ Add More', callback_data: 'add_more_words' },
            { text: '🗑️ Clear All', callback_data: 'clear_saved_words' }
          ], [
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      }
    );
  } else {
    bot.sendMessage(
      chatId, 
      {
        text: '📝 *Your Saved Words*\n\n❌ No words saved yet.*\n\nUse `/saveword <word1> to save up to 5 words for launch alerts.',
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [[
            { text: '💾 Save Words Now', callback_data: 'save_words_help' },
            { text: '◶ Main Menu', callback_data: 'menu_main' }
          ]]
        }
      }
    );
  }
});

bot.onText(/\/clearsavedwords/, (msg) => {
  const chatId = msg.chat.id;
  const words = userSavedWords[chatId];
  
  if (!words || words.length === 0) {
    bot.sendMessage(chatId, 
      `🗂️ *Clear Saved Words*\n\nYou don't have any saved words to clear\\.`, 
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }
  
  bot.sendMessage(chatId, 
    `🗑️ *Clear All Saved Words?*\n\nThis will remove all ${words.length} saved words:\n${words.map(w => `• \`${escapeMarkdownV2(w)}\``).join('\n')}\n\n⚠️ *This action cannot be undone\\!*`, 
    {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Yes, Clear All', callback_data: 'confirm_clear_words' },
          { text: '❌ Cancel', callback_data: 'menu_main' }
        ]]
      }
    }
  );
});

// Enhanced token alert system
async function fetchLatestTokens() {
  try {
    const response = await axios.get('https://api.dexscreener.com/latest/dex/tokens/trending', {
      timeout: 10000
    });
    return response.data || [];
  } catch (error) {
    console.error('Error fetching latest tokens:', error.message);
    return [];
  }
}

async function checkForTokenAlerts() {
  console.log('🔍 Checking for new token alerts...');
  
  try {
    const tokens = await fetchLatestTokens();
    if (!tokens.length) {
      console.log('No tokens found from API');
      return;
    }

    let alertsSent = 0;
    
    for (const [userId, words] of Object.entries(userSavedWords)) {
      if (!words || words.length === 0) continue;
      
      for (const token of tokens) {
        const name = (token.name || '').toLowerCase();
        const symbol = (token.symbol || '').toLowerCase();
        const address = token.address;
        
        const matchingWords = words.filter(word => 
          name.includes(word) || symbol.includes(word)
        );
        
        if (matchingWords.length > 0) {
          const notificationKey = `${userId}_${address}`;
          if (notifiedTokens[notificationKey]) continue;
          
          notifiedTokens[notificationKey] = true;
          
          const alertMessage = `🚨 *NEW TOKEN ALERT\\!*\n\n💎 *${escapeMarkdownV2(token.name || 'Unknown')}* \\(${escapeMarkdownV2(token.symbol || 'N/A')}\\)\n\n🎯 *Matched words:* ${matchingWords.map(w => `\`${escapeMarkdownV2(w)}\``).join(', ')}\n\n📊 *Details:*\n• Price: ${escapeMarkdownV2(token.priceUsd || 'N/A')}\n• DEX: ${escapeMarkdownV2(token.dexId || 'N/A')}\n• Chain: ${escapeMarkdownV2(token.chainId || 'Unknown')}\n• CA: \`${escapeMarkdownV2(address || 'N/A')}\`\n\n⚡ *Quick Actions:*`;
          
          if (address && typeof address === 'string' && address.length > 0) {
            await bot.sendMessage(userId, alertMessage, {
              parse_mode: 'MarkdownV2',
              reply_markup: { 
                inline_keyboard: getTradingBotButtons(address, token.name, token.symbol)
              }
            });
          } else {
            await bot.sendMessage(userId, alertMessage, {
              parse_mode: 'MarkdownV2',
              reply_markup: {
                inline_keyboard: [[
                  { text: '🔍 Search Similar', callback_data: 'menu_search' }
                ]]
              }
            });
          }
          
          alertsSent++;
          
          if (!userFilters[userId]) userFilters[userId] = {};
          userFilters[userId].alertsReceived = (userFilters[userId].alertsReceived || 0) + 1;
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    if (alertsSent > 0) {
      console.log(`✅ Sent ${alertsSent} token alerts`);
    }
    
  } catch (error) {
    console.error('Error in token alert check:', error);
  }
}

// Enhanced utility functions
function passesNumericFilter(pairValue, filter) {
  if (!pairValue) return false;
  
  if (typeof filter === 'object') {
    if (filter.min !== undefined && filter.max !== undefined) {
      return pairValue >= filter.min && pairValue <= filter.max;
    }
    if (filter.op && filter.value !== undefined) {
      if (filter.op === '>') return pairValue > filter.value;
      if (filter.op === '<') return pairValue < filter.value;
      if (filter.op === '=') return Math.abs(pairValue - filter.value) < (filter.value * 0.1);
    }
  }
  return true;
}

// Enhanced error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

bot.on('error', (error) => {
  console.error('Bot error:', error);
});

// Add Express server to bind to a port for Render
const app = express();

// Basic route to confirm the server is running
app.get('/', (req, res) => {
  res.status(200).send('WordSpotr Bot is running!');
});

// Bind to the port provided by Render (or default to 3000 for local development)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Start the alert checking system
console.log('🚨 Starting token alert system...');
setInterval(checkForTokenAlerts, 300000); // Check every 5 minutes
setTimeout(checkForTokenAlerts, 30000);