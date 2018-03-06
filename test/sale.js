const expectThrow = require('./helpers/expectThrow');
require('babel-polyfill');

var Sale = artifacts.require("./Sale.sol");
var TPToken = artifacts.require("./TakeProfitToken.sol");

const promisify = (inner) =>
  new Promise((resolve, reject) =>
    inner((err, res) => {
      if (err) { reject(err) }
      resolve(res);
    })
  );

const getBalance = (account, at) =>
  promisify(cb => web3.eth.getBalance(account, at, cb));


const setBlockchainTime = async function(from_snapshot, time) {
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0});
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_revert", params: [from_snapshot], id: 0});
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 0});
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0});
  bn = await web3.eth.blockNumber;
  bl = await web3.eth.getBlock(bn);
  tm = bl.timestamp;  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [time-tm], id: 0});  
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0});
};

const revertToSnapshot = async function(initial_snapshot) {
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_revert", params: [initial_snapshot], id: 0});
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 0});
  await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0});
}


const getSnapshot = async function() {
      return parseInt((await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 0}))["result"]);
}

//State{Unknown, Prepairing, PreFunding, Funding, Success}
//      0	 1	     2		 3	  4	 

contract('Sale', function(accounts) {
  let initial_snapshot=0;
  let compiled_snapshot=0;
  let initialised_snapshot=0;
  let funding_snapshot=0;
  let infunding_snapshot=0;
  let success_snapshot=0;
  let finalized_snapshot=0;
  let failure_snapshot=0;
  let refunding_snapshot=0;


  let token_owner=accounts[0];
  let withdrawer = accounts[1];
  let owner = accounts[2];
  let nonowner1 = accounts[3];
  let nonowner2 = accounts[4];
  let nonowner3 = accounts[5];

  let start_time = 1520272800+68000; // 5 March 6 pm
  let finish_time = 1521503999; // 19 March
  let default_rate = 8*1e6*1e8/(2e3*1e18);
  let first_period_rate = 1./Math.floor(1/(1.5*default_rate));
  let second_period_rate = 1./Math.floor(1/(1.4*default_rate));
  let third_period_rate = 1./Math.floor(1/(1.3*default_rate));
  let forth_period_rate = 1./Math.floor(1/(1.2*default_rate));
  let fifth_period_rate = 1./Math.floor(1/(1.1*default_rate));
  let sixth_period_rate = 1./Math.floor(1/(1.0*default_rate));

  var token, sale;
  

  before(async function() {
    // Note, testrpc should be patched with https://github.com/ethereumjs/testrpc/issues/390#issuecomment-337638679
    await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0});
    if(initial_snapshot==0){
      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0});
      await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 0});
      initial_snapshot = parseInt((await web3.currentProvider.send({jsonrpc: "2.0", method: "evm_snapshot", params: [], id: 0}))["result"]);
    }
    
  });

  it("should correctly get into prepairing state", async function() {
    token = await TPToken.new(null, {from: token_owner});
    sale = await Sale.new(token.address, withdrawer, {from: owner});
    compiled_snapshot = await getSnapshot();
    assert.equal(await sale.token.call(), token.address, "tokenAddress wasn't set");
    assert.equal(await sale.withdrawAddress.call(), accounts[1], "withdrawAddress wasn't set");
    assert.equal(await sale.getState.call(), 1, "Incorrectly determined state");
  });

  it("should not allow any actions before initialisation", async function() {
    await revertToSnapshot(compiled_snapshot);
    await expectThrow(sale.send(null,{from:nonowner1, amount:100000000000000}));
    await expectThrow(sale.buyTokens(nonowner2, {from: owner}));
  });
  
  it("should not allow initialisation without enough amount of tokens for sale", async function() {
    await revertToSnapshot(compiled_snapshot);
    await expectThrow(sale.initiate({from:owner})); //Sale hasn't enough tokens
    await token.transfer(sale.address, 50000000000000,{from: token_owner});
    await expectThrow(sale.initiate({from:owner})); //still not enough
  });

  it("should not allow initialisation for non-owner", async function() {
    await revertToSnapshot(compiled_snapshot);
    await token.transfer(sale.address, 100*1e6*1e8,{from: token_owner});
    await expectThrow(sale.initiate({from:nonowner1}));
  });

  it("should return excess of tokens to withdrawer", async function() {
    await revertToSnapshot(compiled_snapshot);
    await token.transfer(sale.address, (new web3.BigNumber(18*1e6*1e8)).plus(10),{from: token_owner});
    await sale.initiate({from:owner});
    initialised_snapshot = await getSnapshot();

    assert.equal((await token.balanceOf.call(withdrawer)).toNumber(), 10, "Incorrectly return excesses to withdrawer");
  });

  it("should correctly pass to prefunding", async function() {
    await revertToSnapshot(initialised_snapshot);
    assert.equal(await sale.getState.call(), 2, "Incorrectly determined state");
  });

  it("should not allow any actions before sale start", async function() {
    await revertToSnapshot(initialised_snapshot);
    await expectThrow(sale.send(1*1e18,{from:nonowner1}));
    await expectThrow(sale.buyTokens(accounts[4], {from: accounts[2]}));
  });


  it("should correctly pass to Funding state", async function() {
    await setBlockchainTime(initialised_snapshot, start_time+1);
    assert.equal((await sale.getState.call()).toNumber(), 3, "Incorrectly determined state after startTime");
    funding_snapshot = await getSnapshot();
  });

  it("should correctly accept payments at first period (0-2 days )", async function() {
    await revertToSnapshot(funding_snapshot);
    var amount1 = 1e18;
    var amount2 = 2.22e18;
    await sale.sendTransaction({value:amount1, from:nonowner1});
    await sale.buyTokens(nonowner2,{from:nonowner1, value:amount2});
    await expectThrow(sale.sendTransaction({value:0.0099*1e18, from:nonowner3}));
    await sale.sendTransaction({value:0.01*1e18, from:nonowner3});
    assert.equal((await sale.rate.call()).toNumber(), 1666666, "Incorrect rate");
    assert.equal((await sale.getPurchasedTokens.call(nonowner1)).toNumber(), Math.floor(amount1 * first_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await sale.getPurchasedTokens.call(nonowner2)).toNumber(), Math.floor(amount2 * first_period_rate), "Incorrect amount of calculated tokens via buyTokens");
    assert.equal((await token.balanceOf(nonowner1)).toNumber(), Math.floor(amount1 * first_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await token.balanceOf(nonowner2)).toNumber(), Math.floor(amount2 * first_period_rate), "Incorrect amount of calculated tokens via buyTokens");
  });

  it("should correctly accept payments at second period (2-5 days)", async function() {
    await setBlockchainTime(funding_snapshot, start_time+3*24*3600+1000);
    var amount1 = 1e18;
    var amount2 = 2.22e18;
    await sale.sendTransaction({value:amount1, from:nonowner1});
    await sale.buyTokens(nonowner2,{from:nonowner1, value:amount2});
    assert.equal((await sale.rate.call()).toNumber(), 1785714, "Incorrect rate");
    assert.equal((await sale.getPurchasedTokens.call(nonowner1)).toNumber(), Math.floor(amount1 * second_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await sale.getPurchasedTokens.call(nonowner2)).toNumber(), Math.floor(amount2 * second_period_rate), "Incorrect amount of calculated tokens via buyTokens");
    assert.equal((await token.balanceOf(nonowner1)).toNumber(), Math.floor(amount1 * second_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await token.balanceOf(nonowner2)).toNumber(), Math.floor(amount2 * second_period_rate), "Incorrect amount of calculated tokens via buyTokens");
  });

  it("should correctly accept payments at third period (5-8 days)", async function() {
    await setBlockchainTime(funding_snapshot, start_time+6*24*3600+1000);
    var amount1 = 1e18;
    var amount2 = 2.22e18;
    await sale.sendTransaction({value:amount1, from:nonowner1});
    await sale.buyTokens(nonowner2,{from:nonowner1, value:amount2});
    assert.equal((await sale.rate.call()).toNumber(), 1923076, "Incorrect rate");
    assert.equal((await sale.getPurchasedTokens.call(nonowner1)).toNumber(), Math.floor(amount1 * third_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await sale.getPurchasedTokens.call(nonowner2)).toNumber(), Math.floor(amount2 * third_period_rate), "Incorrect amount of calculated tokens via buyTokens");
    assert.equal((await token.balanceOf(nonowner1)).toNumber(), Math.floor(amount1 * third_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await token.balanceOf(nonowner2)).toNumber(), Math.floor(amount2 * third_period_rate), "Incorrect amount of calculated tokens via buyTokens");
  });

  it("should correctly accept payments at forth periof (8-10)days", async function() {
    await setBlockchainTime(funding_snapshot, start_time+9*24*3600+1000);
    var amount1 = 1e18;
    var amount2 = 2.22e18;
    await sale.sendTransaction({value:amount1, from:nonowner1});
    await sale.buyTokens(nonowner2,{from:nonowner1, value:amount2});
    assert.equal((await sale.rate.call()).toNumber(), 2083333, "Incorrect rate");
    assert.equal((await sale.getPurchasedTokens.call(nonowner1)).toNumber(), Math.floor(amount1 * forth_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await sale.getPurchasedTokens.call(nonowner2)).toNumber(), Math.floor(amount2 * forth_period_rate), "Incorrect amount of calculated tokens via buyTokens");
    assert.equal((await token.balanceOf(nonowner1)).toNumber(), Math.floor(amount1 * forth_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await token.balanceOf(nonowner2)).toNumber(), Math.floor(amount2 * forth_period_rate), "Incorrect amount of calculated tokens via buyTokens");
  });

  it("should correctly accept payments at fifth periof (10-12)days", async function() {
    await setBlockchainTime(funding_snapshot, start_time+11*24*3600+1000);
    var amount1 = 1e18;
    var amount2 = 2.22e18;
    await sale.sendTransaction({value:amount1, from:nonowner1});
    await sale.buyTokens(nonowner2,{from:nonowner1, value:amount2});
    assert.equal((await sale.rate.call()).toNumber(), 2272727, "Incorrect rate");
    assert.equal((await sale.getPurchasedTokens.call(nonowner1)).toNumber(), Math.floor(amount1 * fifth_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await sale.getPurchasedTokens.call(nonowner2)).toNumber(), Math.floor(amount2 * fifth_period_rate), "Incorrect amount of calculated tokens via buyTokens");
    assert.equal((await token.balanceOf.call(nonowner1)).toNumber(), Math.floor(amount1 * fifth_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await token.balanceOf.call(nonowner2)).toNumber(), Math.floor(amount2 * fifth_period_rate), "Incorrect amount of calculated tokens via buyTokens");
  });


  it("should correctly accept payments at sxicth periof (on 13 day)", async function() {
    await setBlockchainTime(funding_snapshot, start_time+13*24*3600+1000);
    var amount1 = 1e18;
    var amount2 = 2.22e18;
    await sale.sendTransaction({value:amount1, from:nonowner1});
    await sale.buyTokens(nonowner2,{from:nonowner1, value:amount2});
    assert.equal((await sale.rate.call()).toNumber(), 2500000, "Incorrect rate");
    assert.equal((await sale.getPurchasedTokens.call(nonowner1)).toNumber(), Math.floor(amount1 * sixth_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await sale.getPurchasedTokens.call(nonowner2)).toNumber(), Math.floor(amount2 * sixth_period_rate), "Incorrect amount of calculated tokens via buyTokens");
    assert.equal((await token.balanceOf.call(nonowner1)).toNumber(), Math.floor(amount1 * sixth_period_rate), "Incorrect amount of calculated tokens via ()");
    assert.equal((await token.balanceOf.call(nonowner2)).toNumber(), Math.floor(amount2 * sixth_period_rate), "Incorrect amount of calculated tokens via buyTokens");
  });

  it("should correctly accept payments near cap at first week", async function() {
    await revertToSnapshot(funding_snapshot);

    initial_balance = await getBalance(nonowner2);
    initial_balance2 = await getBalance(nonowner1);
    initial_balance3 = await getBalance(withdrawer);
    await sale.sendTransaction({value:2999*1e18, from:nonowner1});
    tx = await sale.sendTransaction({value:10*1e18, from:nonowner2});
    gasPrice = web3.eth.getTransaction(tx.tx).gasPrice;
    assert.equal((await getBalance(withdrawer)).minus(initial_balance3).toPrecision(23), (new web3.BigNumber(2.9999988e+21)).toPrecision(23), "Incorrect withdrawn amount");
    assert.equal((await getBalance(sale.address)).toPrecision(5), 0, "Incorrect withdrawn amount");
    
    assert.equal((await token.balanceOf.call(nonowner2)).toNumber(), Math.floor(0.9988e18*first_period_rate)+1, "Incorrect amount of calculated tokens for excesses over cap");
    assert.equal((await sale.getState.call()).toNumber(), 4, "Incorrectly determined state after reaching cap");
    spent = (await token.balanceOf.call(nonowner2)).div(first_period_rate).plus(1);
    assert.equal((await getBalance(nonowner2)).toPrecision(23), initial_balance.minus(spent).minus(gasPrice.mul(tx.receipt.cumulativeGasUsed)).toPrecision(23), "Incorrectly returns excess over cap");
  });


  it("should correctly pass to Success state on first period", async function() {
    await revertToSnapshot(funding_snapshot);

    initial_balance = await getBalance(nonowner2);
    await sale.sendTransaction({value:3500*1e18, from:nonowner1});

    assert.equal((await sale.getState.call()).toNumber(), 4, "Incorrectly determined state after reaching cap");
  });

  it("should correctly pass to Success state on last period", async function() {
    await revertToSnapshot(funding_snapshot);
    initial_balance = await getBalance(nonowner2);
    temp_ss = await getSnapshot();
    await setBlockchainTime(temp_ss, start_time+13*24*3600+1000);
    await sale.sendTransaction({value:4499*1e18, from:nonowner2});
    assert.equal((await sale.getState.call()).toNumber(), 3, "Incorrectly determined state after replenishing on last period");
    await sale.sendTransaction({value:11*1e18, from:nonowner2});
    assert.equal((await sale.getState.call()).toNumber(), 4, "Incorrectly determined state after reaching cap");
  });

  it("should not allow any actions in emergency mode (during success)", async function() {

    await revertToSnapshot(success_snapshot);
    await sale.halt({from:owner})

    expectThrow(sale.send(1*1e18,{from:nonowner1}));
    expectThrow(sale.buyTokens(accounts[4], {from: accounts[2]}));
  });


  it("should not allow set emergency mode for non-owner", async function() {
    await revertToSnapshot(funding_snapshot);
    await sale.sendTransaction({value:100e18, from:nonowner1});
    infunding_snapshot = await getSnapshot();
    expectThrow(sale.halt({from:nonowner1}));
  });

  it("should not allow emergency actions in non-emergency mode", async function() {
    await revertToSnapshot(infunding_snapshot);
    weiRaised = await sale.weiRaised.call(),
    expectThrow(sale.emergencyWithdrawal(weiRaised, {from: owner}));  
    expectThrow(sale.emergencyTokenWithdrawal(1e14, {from: owner})); 
  });

  it("should correctly withdraw tokens in emergency", async function() {

    await revertToSnapshot(infunding_snapshot);
    await sale.halt({from:owner})

    initial_token_balance = await token.balanceOf.call(withdrawer);
    await sale.emergencyTokenWithdrawal(1e14, {from: owner});
    assert.equal((await token.balanceOf.call(withdrawer)).minus(initial_token_balance).toNumber(), 1e14, "Incorrect emergency token withrawal");

  });

  it("finalization", async function() {
    await revertToSnapshot(initial_snapshot);
  });
});
