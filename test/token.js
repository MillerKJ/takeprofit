const expectThrow = require('./helpers/expectThrow');
require('babel-polyfill');

var TPToken = artifacts.require("./TakeProfitToken.sol");

contract('TakeProfitToken', function(accounts) {
  it("should put 100m TP in the owner account", async function() {
    var token = await TPToken.new();
    var balance = await token.balanceOf.call(accounts[0]);
    assert.equal(balance.valueOf(), 100*1e6*1e8, "100 000 000 wasn't in the owner account");
  });
  
  it("should send coin correctly", async function() {
    var token = await TPToken.new();
    var balance_initial_0 = (await token.balanceOf.call(accounts[0])).toNumber();
    var balance_initial_1 = (await token.balanceOf.call(accounts[1])).toNumber();
    var amount = 10;
    await token.transfer(accounts[1], amount, {from: accounts[0]});
    var balance_final_0 = (await token.balanceOf.call(accounts[0])).toNumber();
    var balance_final_1 = (await token.balanceOf.call(accounts[1])).toNumber();

    assert.equal(balance_final_0, balance_initial_0 - amount, "Amount wasn't correctly taken from the sender");
    assert.equal(balance_final_1, balance_initial_1 + amount, "Amount wasn't correctly sent to the receiver");
  });

  it("should transfer ownership correctly", async function() {
      var token = await TPToken.new();
      await expectThrow(token.transferOwnership(accounts[1], {from: accounts[1]}));
      assert.equal( await token.owner.call(), accounts[0], "After transferOwnership called by non-owner, ownership has incorrectly changed"); //Actually useless assertion
      await token.transferOwnership(accounts[1], {from: accounts[0]});
      assert.equal( await token.owner.call(), accounts[1], "After transferOwnership called by owner, ownership hasn't changed");
  });

  it("should not allow operations in halted mode", async function() {
      var token = await TPToken.new();
      await token.halt({from: accounts[0]});
      await expectThrow(token.transfer(accounts[1], 1, {from: accounts[0]}));
      await expectThrow(token.approve(accounts[1], 1, {from: accounts[0]}));
      token.unhalt({from: accounts[0]});
  });

  it("should not allow halt mode setting by non-owner", async function() {
      var token = await TPToken.new();
      await expectThrow(token.halt({from: accounts[1]}));
      await token.halt({from: accounts[0]});
      await expectThrow(token.unhalt({from: accounts[1]}));
  });

  it("should correctly returns to unhalted mode", async function() {
      var token = await TPToken.new();
      await token.halt({from: accounts[0]});
      token.unhalt({from: accounts[0]});

      var balance_initial_0 = (await token.balanceOf.call(accounts[0])).toNumber();
      var balance_initial_1 = (await token.balanceOf.call(accounts[1])).toNumber();
      var amount = 10;
      await token.transfer(accounts[1], amount, {from: accounts[0]});
      var balance_final_0 = (await token.balanceOf.call(accounts[0])).toNumber();
      var balance_final_1 = (await token.balanceOf.call(accounts[1])).toNumber();

      assert.equal(balance_final_0, balance_initial_0 - amount, "Amount wasn't correctly taken from the sender");
      assert.equal(balance_final_1, balance_initial_1 + amount, "Amount wasn't correctly sent to the receiver");
  });

});
