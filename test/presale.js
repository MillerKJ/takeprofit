const expectThrow = require('./helpers/expectThrow');
require('babel-polyfill');

var Presale = artifacts.require("./Presale.sol");
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

//State{Unknown, Prepairing, PreFunding, Funding, Success, Failure, Finalized, Refunding}
//      0	 1	     2		 3	  4	   5	    6	       7

contract('Presale', function(accounts) {
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

  let start_time = 1511892000; // 28 November 6 pm
  let finish_time = 1513641600; // 19 December
  let rate = 1e6*1e8/(2e3*1e18);

  var token, presale;
  

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
    presale = await Presale.new(token.address, withdrawer, {from: owner});
    compiled_snapshot = await getSnapshot();
    assert.equal(await presale.token.call(), token.address, "tokenAddress wasn't set");
    assert.equal(await presale.withdrawAddress.call(), accounts[1], "withdrawAddress wasn't set");
    assert.equal(await presale.getState.call(), 1, "Incorrectly determined state");
  });

  it("should not allow any actions before initialisation", async function() {
    await revertToSnapshot(compiled_snapshot);
    await expectThrow(presale.send(null,{from:nonowner1, amount:100000000000000}));
    await expectThrow(presale.buyTokens(nonowner2, {from: owner}));
    await expectThrow(presale.claimTokens(nonowner2, {from: owner}));
    await expectThrow(presale.refund({from: owner}));
    await expectThrow(presale.finalize({from: owner}));
  });
  
  it("should not allow initialisation without enough amount of tokens for sale", async function() {
    await revertToSnapshot(compiled_snapshot);
    await expectThrow(presale.initiate({from:owner})); //Presale hasn't enough tokens
    await token.transfer(presale.address, 50000000000000,{from: token_owner});
    await expectThrow(presale.initiate({from:owner})); //still not enough
  });

  it("should not allow initialisation for non-owner", async function() {
    await revertToSnapshot(compiled_snapshot);
    await token.transfer(presale.address, 100000000000000,{from: token_owner});
    await expectThrow(presale.initiate({from:nonowner1})); //still not enough
  });

  it("should return excess of tokens to withdrawer", async function() {
    await revertToSnapshot(compiled_snapshot);
    await token.transfer(presale.address, 100000000000010,{from: token_owner});
    await presale.initiate({from:owner});
    initialised_snapshot = await getSnapshot();

    assert.equal(await presale.getState.call(), 2, "Incorrectly determined state");
    assert.equal(await token.balanceOf.call(withdrawer), 10, "Incorrectly return excesses to withdrawer");
  });

  it("should correctly pass to prefunding", async function() {
    await revertToSnapshot(initialised_snapshot);
    assert.equal(await presale.getState.call(), 2, "Incorrectly determined state");
  });

  it("should not allow any actions before presale start", async function() {
    await revertToSnapshot(initialised_snapshot);
    await expectThrow(presale.send(1*1e18,{from:nonowner1}));
    await expectThrow(presale.buyTokens(accounts[4], {from: accounts[2]}));
    await expectThrow(presale.claimTokens(accounts[4], {from: owner}));
    await expectThrow(presale.refund({from: owner}));
    await expectThrow(presale.finalize({from: owner}));
  });


  it("should correctly pass to Funding state", async function() {
    await setBlockchainTime(initialised_snapshot, start_time+1);
    assert.equal((await presale.getState.call()).toNumber(), 3, "Incorrectly determined state after startTime");
    funding_snapshot = await getSnapshot();
  });

  it("should correctly accept payments", async function() {
    await revertToSnapshot(funding_snapshot);
    var amount1 = 1e18;
    var amount2 = 2.22e18;
    await presale.sendTransaction({value:amount1, from:nonowner1});
    await presale.buyTokens(nonowner2,{from:nonowner1, value:amount2});
    await expectThrow(presale.sendTransaction({value:0.0099*1e18, from:nonowner1}));
    assert.equal((await presale.getPurchasedTokens.call(nonowner1)).toNumber(), amount1 * rate, "Incorrect amount of calculated tokens via ()");
    assert.equal((await presale.getPurchasedTokens.call(nonowner2)).toNumber(), amount2 * rate , "Incorrect amount of calculated tokens via buyTokens");
  });


  it("should correctly accept payments near cap", async function() {
    await revertToSnapshot(funding_snapshot);

    initial_balance = await getBalance(nonowner2);
    await presale.sendTransaction({value:1999*1e18, from:nonowner1});
    tx = await presale.sendTransaction({value:10*1e18, from:nonowner2});
    gasPrice = web3.eth.getTransaction(tx.tx).gasPrice;
    assert.equal((await presale.getPurchasedTokens.call(nonowner2)).toNumber(), 1e18*rate, "Incorrect amount of calculated tokens for excesses over cap");
    assert.equal((await presale.getState.call()).toNumber(), 4, "Incorrectly determined state after reaching cap");
    assert.equal((await getBalance(nonowner2)).toPrecision(25), initial_balance.minus(1000000000000000000).minus(gasPrice.mul(tx.receipt.cumulativeGasUsed)).toPrecision(25), "Incorrectly returns excess over cap");
  });

  it("should not allow claim, refund and finalize in Funding state", async function() {
    await revertToSnapshot(funding_snapshot);
    await presale.sendTransaction({value:1e18, from:nonowner3});
    await expectThrow(presale.claimTokens(nonowner3, {from: owner}));
    await expectThrow(presale.refund({from: nonowner3}));
    await expectThrow(presale.finalize({from: owner}));
  });


  it("should correctly pass to Success state", async function() {
    await revertToSnapshot(funding_snapshot);

    initial_balance = await getBalance(nonowner2);
    await presale.sendTransaction({value:2500*1e18, from:nonowner1});

    success_snapshot = await getSnapshot();

    assert.equal((await presale.getState.call()).toNumber(), 4, "Incorrectly determined state after reaching cap");



  });

  it("should not allow claim and refund in Success state", async function() {
    await revertToSnapshot(success_snapshot);
    await expectThrow(presale.claimTokens(nonowner1, {from: owner})); //Not finalized yet
    await expectThrow(presale.refund({from: owner}));
  });

  it("should not accept money in Success state", async function() {

    await revertToSnapshot(success_snapshot);
    await expectThrow(presale.sendTransaction({value:20*1e18, from:nonowner3}));

  });

  it("should not allow any actions in emergency mode (during success)", async function() {

    await revertToSnapshot(success_snapshot);
    await presale.halt({from:owner})

    expectThrow(presale.send(1*1e18,{from:nonowner1}));
    expectThrow(presale.buyTokens(accounts[4], {from: accounts[2]}));
    expectThrow(presale.claimTokens(accounts[4], {from: owner}));
    expectThrow(presale.refund({from: owner}));
    expectThrow(presale.finalize({from: owner})); 
  });

  it("should transfer raised money on finalize", async function() {
    await revertToSnapshot(success_snapshot);

    initial_balance = await getBalance(withdrawer);
    await presale.finalize({from: owner});
    final_balance = await getBalance(withdrawer);
    assert.equal(initial_balance.plus(2e3*1e18).toString(), final_balance.toString(), "Incorrectly transfer raised money");
 
  });

  it("should correctly pass to Finalized state", async function() {
    await revertToSnapshot(success_snapshot);

    await expectThrow(presale.finalize({from: nonowner1}));
    await presale.finalize({from: owner});
    assert.equal((await presale.getState.call()).toNumber(), 6, "Incorrectly determined state after finalization");

    finalized_snapshot = await getSnapshot();

    await expectThrow(presale.refund({from: owner}));
  });

  it("should not allow refund in Finalized state", async function() {
    await revertToSnapshot(finalized_snapshot);
    await expectThrow(presale.refund({from: owner}));
  });

  it("should not allow any actions in emergency mode (during finalized)", async function() {

    await revertToSnapshot(finalized_snapshot);
    await presale.halt({from:owner})

    expectThrow(presale.send(1*1e18,{from:nonowner1}));
    expectThrow(presale.buyTokens(accounts[4], {from: accounts[2]}));
    expectThrow(presale.claimTokens(accounts[4], {from: owner}));
    expectThrow(presale.refund({from: owner}));
    expectThrow(presale.finalize({from: owner})); 
  });

  it("should transfer claimed tokens", async function() {
    await revertToSnapshot(finalized_snapshot);

    initial_token_balance = await token.balanceOf.call(nonowner1);
    await presale.claim({from: nonowner1});
    assert.equal((await token.balanceOf.call(nonowner1)).minus(initial_token_balance).toNumber(), 1e6*1e8, "Incorrectly transfer purchased coins");    
  });

  it("should transfer claimed coins(delegated)", async function() {
    await revertToSnapshot(finalized_snapshot);

    initial_token_balance = await token.balanceOf.call(nonowner1);
    await presale.claimTokens(nonowner1, {from: nonowner2});
    assert.equal((await token.balanceOf.call(nonowner1)).minus(initial_token_balance).toNumber(), 1e6*1e8, "Incorrectly transfer purchased coins");    
  });

  it("should correctly pass to Refunding state", async function() {

    await revertToSnapshot(funding_snapshot);
    await presale.sendTransaction({value:100e18, from:nonowner1});
    now = await getSnapshot();
    await setBlockchainTime(now, 1513814400);
    assert.equal((await presale.getState.call()).toNumber(), 7, "Incorrectly determined state after not reaching cap");
    refunding_snapshot = await getSnapshot();

  });

  it("should correctly refund", async function() {

    await revertToSnapshot(refunding_snapshot);
    initial_balance = await getBalance(nonowner1);
    tx = await presale.refund({from: nonowner1});
    gasPrice = web3.eth.getTransaction(tx.tx).gasPrice;
    final_balance = await getBalance(nonowner1);
    assert.equal(initial_balance.minus(gasPrice.mul(tx.receipt.cumulativeGasUsed)).plus(100*1e18).toString(),
                 final_balance.toString(), "Incorrectly transfer raised money");

  });


  it("should correctly refund(delegated)", async function() {

    await revertToSnapshot(refunding_snapshot);
    initial_balance = await getBalance(nonowner1);
    await presale.delegatedRefund(nonowner1, {from: nonowner2});
    final_balance = await getBalance(nonowner1);
    assert.equal(initial_balance.plus(100*1e18).toString(), final_balance.toString(), "Incorrectly transfer raised money");

  });

  it("should not accept money during refund", async function() {

    await revertToSnapshot(refunding_snapshot);
    await expectThrow(presale.sendTransaction({value:20*1e18, from:nonowner3}));

  });

  it("should not allow any actions in emergency mode (during refunding)", async function() {

    await revertToSnapshot(refunding_snapshot);
    await presale.halt({from:owner})

    expectThrow(presale.send(1*1e18,{from:nonowner1}));
    expectThrow(presale.buyTokens(accounts[4], {from: accounts[2]}));
    expectThrow(presale.claimTokens(accounts[4], {from: owner}));
    expectThrow(presale.refund({from: owner}));
    expectThrow(presale.finalize({from: owner})); 
  });

  it("should not allow set emergency mode for non-owner", async function() {
    await revertToSnapshot(funding_snapshot);
    await presale.sendTransaction({value:100e18, from:nonowner1});
    infunding_snapshot = await getSnapshot();
    expectThrow(presale.halt({from:nonowner1}));
  });

  it("should not allow emergency actions in non-emergency mode", async function() {
    await revertToSnapshot(infunding_snapshot);
    weiRaised = await presale.weiRaised.call(),
    expectThrow(presale.emergencyWithdrawal(weiRaised, {from: owner}));  
    expectThrow(presale.emergencyTokenWithdrawal(1e14, {from: owner})); 
  });

  it("should not allow any actions in emergency mode (during funding)", async function() {

    await revertToSnapshot(infunding_snapshot);
    await presale.halt({from:owner})

    expectThrow(presale.send(1*1e18,{from:nonowner1}));
    expectThrow(presale.buyTokens(accounts[4], {from: accounts[2]}));
    expectThrow(presale.claimTokens(accounts[4], {from: owner}));
    expectThrow(presale.refund({from: owner}));
    expectThrow(presale.finalize({from: owner})); 
  });

  it("should correctly withdraw raised funds and tokens in emergency", async function() {

    await revertToSnapshot(infunding_snapshot);
    await presale.halt({from:owner})

    initial_token_balance = await token.balanceOf.call(withdrawer);
    await presale.emergencyTokenWithdrawal(1e14, {from: owner});
    assert.equal((await token.balanceOf.call(withdrawer)).minus(initial_token_balance).toNumber(), 1e14, "Incorrect emergency token withrawal");

    initial_balance = await getBalance(withdrawer);
    await presale.emergencyWithdrawal(weiRaised, {from: owner})
    final_balance = await getBalance(withdrawer);
    assert.equal(initial_balance.plus(100*1e18).toString(), final_balance.toString(), "Incorrect emergency ether withrawal");

  });

  it("finalization", async function() {
    await revertToSnapshot(initial_snapshot);
  });
});
