'use strict';
/**
 * Represents a subscription to a pair
 */
class Subscription {
  constructor(cPair) {
    this.currencyPair = cPair;
    this.lastDate;
  }
}

module.exports = Subscription;
