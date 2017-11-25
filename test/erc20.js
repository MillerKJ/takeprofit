//  Source: https://github.com/OpenZeppelin/zeppelin-solidity

const expectThrow = require('./helpers/expectThrow');
require('babel-polyfill');

var TPToken = artifacts.require("./TakeProfitToken.sol");

contract('TakeProfitToken(ERC20 checks)', function(accounts) {

  let token;
  let totalSupply = 100*1e6*1e8; //100 milions tokens

  beforeEach(async function() {
    token = await TPToken.new();
  });

  it("should put 1e8 TP in the owner account", async function() {
    var token = await TPToken.new();
    var balance = await token.balanceOf.call(accounts[0]);
    assert.equal(balance.valueOf(), totalSupply, "100 000 000 wasn't in the owner account");
  });


  it("should return the correct totalSupply after construction", async function() {
    let totalSupply = await token.totalSupply();
    assert.equal(totalSupply, totalSupply, "Total supply isn't equal to 100 000 000");
  })

  it("should return correct balances after transfer", async function(){
    let transfer = await token.transfer(accounts[1], totalSupply, {from: accounts[0]});
    let firstAccountBalance = await token.balanceOf(accounts[0]);
    assert.equal(firstAccountBalance, 0);
    let secondAccountBalance = await token.balanceOf(accounts[1]);
    assert.equal(secondAccountBalance, totalSupply);
  });

  it('should throw an error when trying to transfer more than balance', async function() {
    var balance = await token.balanceOf.call(accounts[0]);
    await expectThrow(token.transfer(accounts[1], balance.plus(1), {from: accounts[0]}));
  });

  it('should throw an error when trying to transfer to 0x0', async function() {
    await expectThrow(token.transfer(0x0, 100));
  });

  it('should return the correct allowance amount after approval', async function() {
    await token.approve(accounts[1], 100, {from: accounts[0]});
    let allowance = await token.allowance(accounts[0], accounts[1]);
    assert.equal(allowance, 100);
  });

  it('should return correct balances after transfering from another account', async function() {
    await token.approve(accounts[1], 100);
    await token.transferFrom(accounts[0], accounts[2], 100, {from: accounts[1]});

    let balance0 = await token.balanceOf(accounts[0]);
    assert.equal(balance0, totalSupply-100);

    let balance1 = await token.balanceOf(accounts[2]);
    assert.equal(balance1, 100);

    let balance2 = await token.balanceOf(accounts[1]);
    assert.equal(balance2, 0);
  });

  it('should throw an error when trying to transfer more than allowed', async function() {
    await token.approve(accounts[1], 99);
    await expectThrow(token.transferFrom(accounts[0], accounts[2], 100, {from: accounts[1]}));
  });

  it('should throw an error when trying to transferFrom more than _from has', async function() {
    let balance0 = await token.balanceOf(accounts[0]);
    await token.approve(accounts[1], balance0+10);
    await expectThrow(token.transferFrom(accounts[0], accounts[2], balance0+1, {from: accounts[1]}));
  });

  describe('validating allowance updates to spender', function() {
    let preApproved;

    it('should start with zero', async function() {
      preApproved = await token.allowance(accounts[0], accounts[1]);
      assert.equal(preApproved, 0);
    })

    it('should update allowance', async function() {
      await token.approve(accounts[1], 50);
      let postApproved = await token.allowance(accounts[0], accounts[1]);
      assert.equal(postApproved, 50);
      await token.approve(accounts[1], 0);
      let postApproved2 = await token.allowance(accounts[0], accounts[1]);
      assert.equal(postApproved2, 0);
    })
  });


  it('should throw an error when trying to transferFrom to 0x0', async function() {
    await token.approve(accounts[1], 100);
    await expectThrow(token.transferFrom(accounts[0], 0x0, 100, {from: accounts[1]}));
  });



});
