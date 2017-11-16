pragma solidity ^0.4.11;

import './SafeMath.sol';
import './Token.sol';
import './Haltable.sol';

/**
 * @title Presale
 * @dev Presale is a base contract for managing a token Presale.
 * Presales have a start and end timestamps, where investors can make
 * token purchases and the Presale will assign them tokens based
 * on a token per ETH rate. Funds collected are forwarded to a wallet
 * as they arrive.
 */
contract Presale is Haltable {
  using SafeMath for uint256;

  // The token being sold
  Token public token;

  // start and end timestamps where investments are allowed (both inclusive)
  uint256 constant public startTime = 1511287200; // 21 Nov 2017 @ 18:00   (UTC)
  uint256 constant public endTime =   1513814400; // 21 Dec 2017 @ 12:00am (UTC)

  uint256 constant public cap = 2000 ether;

  // address where funds will be transfered
  address public withdrawAddress;

  // how many weis buyer need to pay for one token unit
  uint256 public rate = 20000000;

  // amount of raised money in wei
  uint256 public weiRaised;

  bool public initiated = false;
  bool public finalized = false;

  /**
   * event for token purchase logging
   * @param purchaser who paid for the tokens
   * @param beneficiary who got the tokens
   * @param value weis paid for purchase
   * @param amount amount of tokens purchased
   */
  event TokenPurchase(address indexed purchaser, address indexed beneficiary, uint256 value, uint256 amount);

  // we always refund to address from which we get money, while tokens can be bought for another address
  mapping (address => uint256) purchasedTokens;
  mapping (address => uint256) receivedFunds;

  enum State{Unknown, Prepairing, PreFunding, Funding, Success, Failure, Finalized, Refunding}

  function Presale(address token_address, address _withdrawAddress) public {
    require(startTime >= now);
    require(endTime >= startTime);
    require(rate > 0);
    require(withdrawAddress == address(0));
    require(_withdrawAddress != address(0));
    require(cap>0);
    token = Token(token_address);
    withdrawAddress = _withdrawAddress;
  }

  function initiate() public onlyOwner {
    require(token.balanceOf(this) >= uint256(10)**(6+8));
    initiated = true;
    if(token.balanceOf(this)>uint256(10)**(6+8))
      require(token.transfer(withdrawAddress, token.balanceOf(this).sub(uint256(10)**(6+8))));
  }

  // fallback function can be used to buy tokens
  function () public stopInEmergency payable {
    buyTokens(msg.sender);
  }

  // low level token purchase function
  function buyTokens(address beneficiary) public stopInEmergency inState(State.Funding) payable {
    require(beneficiary != address(0));
    require(validPurchase());

    uint256 weiAmount = msg.value;
    uint256 weiExcess = 0;

    if(weiRaised.add(weiAmount)>cap) {
      weiExcess = weiRaised.add(weiAmount).sub(cap);
      weiAmount = cap.sub(weiRaised);
    }

    // calculate token amount to be bought
    uint256 tokens = weiAmount.div(rate);

    // update state
    weiRaised = weiRaised.add(weiAmount);

    purchasedTokens[beneficiary] += tokens;
    receivedFunds[msg.sender] += weiAmount;
    if(weiExcess>0) {
      msg.sender.transfer(weiExcess);
    }
    TokenPurchase(msg.sender, beneficiary, weiAmount, tokens);
  }

  // @return true if the transaction can buy tokens
  function validPurchase() internal constant returns (bool) {
    bool valuablePurchase = (msg.value > 0.01 ether);
    return valuablePurchase;
  }

  function getPurchasedTokens(address beneficiary) public constant returns (uint256) {
    return purchasedTokens[beneficiary];
  }

  function getReceivedFunds(address buyer) public constant returns (uint256) {
    return receivedFunds[buyer];
  }

  function claim() public stopInEmergency inState(State.Finalized) {
    claimTokens(msg.sender);
  }


  function claimTokens(address beneficiary) public stopInEmergency inState(State.Finalized) {
    require(purchasedTokens[beneficiary]>0);
    uint256 value = purchasedTokens[beneficiary];
    purchasedTokens[beneficiary] -= value;
    require(token.transfer(beneficiary, value));
  }

  function refund() public stopInEmergency inState(State.Refunding) {
    delegatedRefund(msg.sender);
  }

  function delegatedRefund(address beneficiary) public stopInEmergency inState(State.Refunding) {
    require(receivedFunds[beneficiary]>0);
    uint256 value = receivedFunds[beneficiary];
    receivedFunds[beneficiary] = 0;
    beneficiary.transfer(value);
  }

  function finalize() public inState(State.Success) onlyOwner stopInEmergency {
    require(!finalized);
    withdrawAddress.transfer(weiRaised);
    finalized = true;
  }

  function emergencyWithdrawal(uint256 _amount) public onlyOwner onlyInEmergency {
    withdrawAddress.transfer(_amount);
  }

  function emergencyTokenWithdrawal(uint256 _amount) public onlyOwner onlyInEmergency {
    require(token.transfer(withdrawAddress, _amount));
  }

  //It is function and not variable, thus it can't be stale
  function getState() public constant returns (State) {
    if(finalized) return State.Finalized;
    if(!initiated) return State.Prepairing;
    else if (block.timestamp < startTime) return State.PreFunding;
    else if (block.timestamp <= endTime && weiRaised<cap) return State.Funding;
    else if (weiRaised>=cap) return State.Success;
    else if (weiRaised > 0 && block.timestamp >= endTime && weiRaised<cap) return State.Refunding;
    else return State.Failure;
  }

  modifier inState(State state) {
    require(getState() == state);
    _;
  }
}
