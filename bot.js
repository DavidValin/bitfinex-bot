'use strict';
/**
 *   Waves Surfer Bot
 *   My daily smart trading bot
 *   =====================================================
 *    @author   David Valin <hola@davidvalin.com>
 *    @version  0.1
 *    @date     12-09-2017
 *
 *    How to use:
 *    _____________________
 *    1. Open an account in bitfinex
 *    2. Get a par of api key and api key secret
 *    3. node bot.js
 */

// Model
const Currency = require("./model/currency");
const Pair = require("./model/pair");
const Asset = require("./model/asset");
// Libs
const BFX = require('bitfinex-api-node');
const talib = require('talib');
const moment = require('moment');
const util = require('util');

class WavesSurferBot {
  constructor(apiKey, apiSecret, term) {
    // Strategy parameters
    this.params = {
        // How many bars should be consider to calculate the maximum previous returns.
        'maxPercentageWindow': 10,
    };
    this.term = term;
    this.term.clear();
    this.term.green("\n + Trying to catch the next IOT wave...\n");

    this.authenticated = true;
    this.exitCurrencies = [new Currency("USD"), new Currency("EUR")]
    this.mainBaseCurrency = new Currency("ETH");
    this.assets = {
      currencies: {
        "ETH": { "balance": 1000 },
        "IOT": { "balance": 1000 }
      },
      cryptocurrencies: {},
      commodities: {}
    };
    this.returns = {

    };
    // Queue of orders
    this.amounts_to_buy = {};
    this.amountToSell = {}
    // ------------------
    this.positions = {

    };
    this.orders = [];
    this.subscriptions = [];
    this.marketData = {};
    this.dailyGoals = {
      max_loss: 3, // percentage
      max_profit: 3, // percentage
      max_per_operation: 3 // percentage
    };
    this.dailyProfitPercent = 1;

    this.term("\n   --> Exit currencies: "); this.term.brightYellow(this.exitCurrencies.map(function(currency) { return currency.name }));
    this.term("\n   --> Main base trading currency: "); this.term.brightYellow(this.mainBaseCurrency.name);
    this.term("\n   --> Detecting waves in currency: "); this.term.brightYellow("IOT");

    this.term("\n   --> Daily Goals: ");
    this.term("\n        - Max % loss: "); this.term.brightYellow(this.dailyGoals.max_loss+"%");
    this.term("\n        - Max % profit: "); this.term.brightYellow(this.dailyGoals.max_profit+"%");

    this.term.cyan("\n   --> Balance ETH: "); this.term.brightYellow(this.assets["currencies"]["ETH"]["balance"] == 0 ? "0" : this.assets["currencies"]["ETH"]["balance"]);
    this.term.cyan("\n   --> Balance IOT: "); this.term.brightYellow(this.assets["currencies"]["IOT"]["balance"] == 0 ? "0" : this.assets["currencies"]["IOT"]["balance"]);

    this.term.white("\n\n + Connecting to bitfinex...");
    this.bws = new BFX(apiKey, apiSecret, { version: 2, transform: true }).ws

    this.bws.on('auth', () => {
      // emitted after .auth()
      // needed for private api endpoints

      this.term.green("\n + Authenticated!\n");
      this.authenticated = true;
      // bws.submitOrder ...
    });

    this.bws.on('open', () => {
      this.subscribe('IOTUSD');
      this.subscribe('IOTETH');
      // authenticate
      // bws.auth()
    });

    // New order received
    this.bws.on('on', (order) => {
      console.log('order : ', order);
    });
    // Order update
    this.bws.on('ou', (order) => {
      console.log('order update: ', order);
    });
    // Wallet snapshot
    this.bws.on('ws', (walletSnapshot) => {
      console.log('wallet snapshot', walletSnapshot);
    });

    term.white("\n + Waiting for next candle...");

    /**
     * On ticker received...
     */
    this.bws.on('ticker', (plainPair, ticker) => {
      ((plainPair, ticker) => {
        const pair = new Pair(plainPair.substr(1, plainPair.length-1));

        // Update the returns only when there is a position where the target currency of the pair is our main base currency
        if (this.positions[pair.getSourceCurrency()] && pair.getTargetCurrency() == this.mainBaseCurrency.name) {
          this.updateReturns(pair.getSourceCurrency(), pair.getTargetCurrency());
          if (this.hasPositionsInAsset(pair.getSourceCurrency(), pair.getTargetCurrency())) {
            console.log("\n + I bought "+pair.getSourceCurrency()+ " at " + this.positions[pair.getSourceCurrency()]["purchasePrice"] + " " + this.positions[pair.getSourceCurrency()]["purchaseAssetName"]);
            console.log("\n + Current price IOTETH "+this.marketData["IOTETH"]["now"]["BID"]);
            this.term.green("\n + Current return: "); this.term.brightYellow(this.positions[pair.getSourceCurrency()]["currentReturn"]);
          }
        }
        if (
          this.hasDataForPeriod(pair, "one_min")
          // Make sure a new candlestick for the period just started
          && !this.marketData[pair.name]['one_min'][this.getIndexByPeriod("one_min")]) {
            // this.term.white("\n     + Market data: ");
            // console.log(util.inspect(this.marketData, {depth: null, colors: true}))

            const indexPrevMin = this.getIndexByPeriodNMinutesAgo("one_min", 1);
            // console.log('indexPrevMin: ', indexPrevMin);

            // Output market data for prev (finished) minute candle
            this.term.brightYellow("\n + "+pair.name);
            this.term.white(" + OPEN: "); this.term.brightYellow(this.marketData[pair.name]['one_min'][indexPrevMin]["open"]);
            this.term.white(" + CLOSE: "); this.term.brightYellow(this.marketData[pair.name]['one_min'][indexPrevMin]["close"]);
            this.term.white(" + HIGH: "); this.term.brightYellow(this.marketData[pair.name]['one_min'][indexPrevMin]["high"]);
            this.term.white(" + LOW "); this.term.brightYellow(this.marketData[pair.name]['one_min'][indexPrevMin]["low"]);

            // Take decisions only if...
            if (pair.getTargetCurrency() != this.mainBaseCurrency.name) {
              // My smart guy
              this.takeDecisions(pair, 'one_min', ticker);
            }
          }

        // Update the candlebar
        this.updateCandlebar(pair, 'one_min', ticker);

        // Update last price
        this.marketData[pair.name]["now"] = ticker;

        // TODO: Update profit/loss

      })(plainPair, ticker);
    });

    this.bws.on('error', console.error)
  }

  hasPositionsInAsset(assetName) {
    return this.positions[assetName] ? true : false;
  }

  /**
   * Subscribe to a pair
   */
  subscribe(pair) {
    // this.term.green("\n + Subscribing to pair "); this.term.brightYellow(pair);
    this.marketData[pair] = {
      'one_min': {},
      'five_mins': {},
      'ten_mins': {},
      'half_hour': {},
      'one_hour': {},
      'two_hours': {},
      'six_hours': {},
      'one_day': {}
    };
    this.bws.subscribeTicker(pair);
    this.term.white("\n + Subscribed to "); this.term.brightYellow(pair);
  }

  /**
   * Checks wether we have market data for a pair in a specific period
   */
  hasDataForPeriod(pair, periodName) {
    return Object.keys(this.marketData[pair.name][periodName]).length > 0 ? true : false;
  }

  /**
   * Retrieve the current minute index
   */
  getIndexByPeriod(periodName) {
    switch (periodName) {
      case "one_min":
        return moment().format().substr(0, 16);
        break;
      case "five_mins":
        break;
      case "ten_mins":
        break;
      case "half_hour":
        break;
      case "one_hour":
        break;
      case "two_hours":
        break;
      case "six_hours":
        break;
      case "one_day":
        break;
      default:
        // By minute
        return moment().format().substr(0, 16).replace('T', '__');
    }
  }

  /**
   * Retrieves an unique index by periodName for N periods ago
   */
  getIndexByPeriodNMinutesAgo(periodName, nPeriodsAgo) {
    let indexByCurrMin = this.getIndexByPeriod(periodName);
    // TODO: map periodName to moment() period for when using different than 1 min periods
    return moment(indexByCurrMin).subtract(nPeriodsAgo, 'minute').format().substr(0, 16);
  }

  /**
   * Updates the candlestick data for a period
   */
  updateCandlebar(pair, periodName, ticker) {
    const indexByCurrMin = this.getIndexByPeriod("one_min");
    // if (!this.marketData[pair][periodName]) { this.marketData[pair][periodName] = {}; }
    if (!this.marketData[pair.name][periodName][indexByCurrMin]) {
      this.marketData[pair.name][periodName][indexByCurrMin] = {
        low: ticker['BID'],
        high: ticker['BID'],
        open: ticker['BID'],
        close: ticker['BID']
      }
    }

    // The open is set on initialization
    // Update the open
    this.marketData[pair.name][periodName][indexByCurrMin]['close'] = ticker['BID'];
    // Update the low
    if (this.marketData[pair.name][periodName][indexByCurrMin]['low'] > ticker['BID']) {
      this.marketData[pair.name][periodName][indexByCurrMin]['low'] = ticker['BID'];
    }
    // Update the high
    if (this.marketData[pair.name][periodName][indexByCurrMin]['high'] < ticker['BID']) {
      this.marketData[pair.name][periodName][indexByCurrMin]['high'] = ticker['BID'];
    }
  }

  /**
   * Transform the candlesticks to talib market data
   */
  mapMarket(pair, periodName) {
    let newMap = {
      "_comment": "1min",
      "open":   [],
      "close":  [],
      "low":    [],
      "high":   []
    };

    const indexKeys = Object.keys(this.marketData[pair.name][periodName]);
    for (var i = 0; i < indexKeys.length; i++) {
      // This is one minute data
      newMap["open"].push(this.marketData[pair.name][periodName][indexKeys[i]]["open"]);
      newMap["close"].push(this.marketData[pair.name][periodName][indexKeys[i]]["close"]);
      newMap["low"].push(this.marketData[pair.name][periodName][indexKeys[i]]["low"]);
      newMap["high"].push(this.marketData[pair.name][periodName][indexKeys[i]]["high"]);
    }
    return newMap;
  }

  /**
   * Updates the current returns based on a position
   */
  updateReturns(assetName, exchangeCurrency) {
    if (this.hasPositionsInAsset(assetName)) {
      const currentReturn = this.getReturnPercentage(this.positions[assetName]["purchasePrice"], this.marketData[assetName+exchangeCurrency]["now"]["BID"]);
      this.positions[assetName]["currentReturn"] = currentReturn;
    }
  }

  /**
   * Determine whether we should buy an asset or not
   */
  getAmountIShouldBuyNow(assetName, pair, periodName, ticker) {
    const self = this;
    const marketData = this.mapMarket(pair, periodName);

    /**
     * Waves Catcher algorythm -----------------------
     */

    if (marketData["close"].length < 3) {
      this.term.red("\n     + Not enough data");
      return 0;
    }

    /* Step 1) Calculate returns in percentage for the last maxPercentageWindow minutes */
    let pricesWindow = marketData["close"].slice(-1 * this.params['maxPercentageWindow']);
    let returns = pricesWindow.map(function(currentPrice, idx) {
        return idx > 0 ? this.getReturnPercentage(pricesWindow[idx-1], currentPrice) : 0;
    }, this);

    console.log("\n");
    console.log(util.inspect(returns, {depth: null, colors: true}));

    /* Step 2) Calculate the max return for the last maxPercentageWindow minutes before the last returns value */
    let maxReturnPercentage = Math.max.apply(null, returns.map(function(ret) { return Math.abs(ret); }).slice(null, -1));

    this.term.white("\n     + Max return in prev 10 min: " + maxReturnPercentage);

    /* Step 3) Detect drastic change up! */
    const percentageRelativeToMax = this.getReturnPercentage(maxReturnPercentage, returns[returns.length-1]);
    this.term.white("\n     + Volatility relative to prev 10 min: "+percentageRelativeToMax+"%");

    const isUp = returns[returns.length-1] > 0;
    this.term.green("\n     + Market " + (isUp ? "is up!" : "is down!"));

    if (Math.abs(percentageRelativeToMax) > 200 && isUp) {
      this.term.green("\n  + I should buy here boy!");
      return Math.round(this.assets["currencies"][assetName]["balance"] / 100);
    } else {
      return 0;
    }
  }

  /**
   * Retrieves the return percentage from a price A to a price B. Negative means negative return (loss)
   */
  getReturnPercentage(priceA, priceB) {
    return ((priceB / priceA) - 1) * 100;
  }

  /**
   * Determine wether I should sell an asset or not
   */
  getAmountIShouldSellNow(assetName, ticker) {
    return false;
    // TODO: Implement
    // for (var i = 0; i < this.assets.length; i++) {
    //   this.assets[i].assetName =
    //   this.dailyProfitPercent;
    // }
  }

  /**
   * Based on the most recent market data updates a position return (% win/loss)
   */
  updatePositionReturn() {

  }

  /**
   * Buy an asset
   */
  buy(assetName, amount, price, exchangeCurrency) {
    const exchangeCurrencyCost = amount*price;

    if (!this.authenticated) {
      console.log(" + I tried to buy but not authenticated yet...");
      return;
    }
    if (this.assets['currencies'][assetName].balance < exchangeCurrencyCost) {
      console.log(" + Sorry boy, no cash enough to buy "+exchangeCurrencyCost);
      return;
    }

    const order = ([0, 'on', null, {
      type: 'EXCHANGE LIMIT',
      symbol: assetName+this.mainBaseCurrency.name,
      amount: amount,
      price: price,
      hidden: 0,
      postonly: 0
     }]);

     this.bws.submitOrder(order);

     // Update balances
     this.registerSell(exchangeCurrency.name, exchangeCurrencyCost)
     this.registerBuy(assetName, amount, exchangeCurrency);

     this.term.cyan("\n  + New balance "+exchangeCurrency.name+" "); this.term.brightYellow(this.assets["currencies"][exchangeCurrency.name]["balance"] == 0 ? "0" : this.assets["currencies"][exchangeCurrency.name]["balance"]);
     this.term.cyan("\n  + New balance "+assetName+" "); this.term.brightYellow(this.assets["currencies"][assetName]["balance"]);
  }

  /**
   * Retrieves the last price for a pair
   */
  getLastTicker(pair) {
    return this.marketData[pair.name]["now"];
  }

  /**
   * Retrieves the most recent ASK price for a pair
   */
  getCurrentAskPrice(pair) {
    return this.getLastTicker(pair)["ASK"];
  }

  /**
   * Registers a the purchase of an asset
   */
  registerBuy(assetName, amount, exchangeCurrency) {
    this.term.green("\n + Registering a buy: "); this.term.brightYellow(assetName + " " + amount);
    // Update the balance
    this.assets["currencies"][assetName]["balance"] += amount;
    if (!this.positions[assetName]) { this.positions[assetName] = {}; }
    this.positions[assetName]["purchasePrice"] = this.marketData[assetName+exchangeCurrency.name]["now"]["ASK"];
    this.positions[assetName]["purchaseAssetName"] = exchangeCurrency.name;
  }

  /**
   * Registers a sell of an asset
   */
  registerSell(assetName, amount) {
    this.term.green("\n + Registering a sell: "); this.term.brightYellow(assetName + " " + amount);
    if (!this.assets["currencies"][assetName]) {
      this.term.red("\n   + I tried to sell "+assetName+" but you don't have any...");
      return;
    }
    // Update the balance
    this.assets["currencies"][assetName]["balance"] -= amount;
  }

  /**
   * Take decisions wether we should buy or sell any asset
   */
  takeDecisions(pair, periodName, ticker) {
    const sourceCurrency = pair.getSourceCurrency();

    this.term.green("\n + Taking decisions...");
    this.term.white("\n   + Checking if I should buy or sell "); this.term.brightYellow(sourceCurrency);

    const amountsToBuy = this.getAmountIShouldBuyNow(sourceCurrency, pair, periodName, ticker);
    const amountsToSell = this.getAmountIShouldSellNow(sourceCurrency, pair, periodName, ticker);

    if (amountsToBuy > 0) {
      const marketData = this.mapMarket(pair, periodName);
      this.term.green("\n     + I should buy "); this.term.brightYellow(amountsToBuy + ' of ' + sourceCurrency);
      this.term.white("\n       + Amounts to buy: "); this.term.brightYellow(amountsToBuy == 0 ? "0" : amountsToBuy);
      this.term.white("\n       + Amounts to sell: "); this.term.brightYellow(amountsToSell == 0 ? "0" : amountsToSell);

      this.buy(sourceCurrency, amountsToBuy, this.getCurrentAskPrice(new Pair("IOT"+this.mainBaseCurrency.name)), this.mainBaseCurrency);
    } else {
      this.term.red("\n     + I should not buy "+sourceCurrency+" here!");
    }

    if (amountsToSell > 0) {
      this.term.red("\n     + Yes! I should sell "); this.term.brightYellow(amountToSell + ' of ' + this.sourceCurrency);
      this.sell(amountToSell, this.sourceCurrency);
    }
    term.white("\n + Waiting for next candle...");
  }
}

/**
 * Cli
 */
const self = this;
var term = require( 'terminal-kit' ).terminal;

const printBanner = function() {
  term.white()
};

term.clear();

term.on( 'key' , function( name , matches , data ) {
	if ( name === 'CTRL_C' ) {
    term.red("\n + Terminating!\n");
    process.exit();
  }
});

var autoComplete =  ['IOTUSD' , 'IOTBTC' , 'IOTETH'];
term("\n ? Enter bitfinex api Key: ");

term.inputField({ history: [] , autoComplete: [] , autoCompleteMenu: false} ,
	function( error , apiKeyInput ) {
    term.white("\n ? Enter bitfinex api Secret: ");
    term.inputField({ history: [] , autoComplete: [] , autoCompleteMenu: false} ,
    	function( error , apiSecretInput ) {
        // Catch the waves
        self.bot = new WavesSurferBot(apiSecretInput, apiSecretInput, term);
        //
    		// process.exit();
    	}
    );
	}
);
