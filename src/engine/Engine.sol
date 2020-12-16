pragma solidity 0.6.1;

import "../dependencies/DSMath.sol";
import "../dependencies/token/BurnableToken.sol";
import "../prices/IPriceSource.sol";
import "../version/Registry.sol";

/// @notice Liquidity contract and token sink
contract Engine is DSMath {

    event RegistryChange(address registry);
    event SetPbguPrice(uint pbguPrice);
    event PbguPaid(uint amount);
    event Thaw(uint amount);
    event Burn(uint amount);

    uint public constant RISQ_DECIMALS = 18;

    Registry public registry;
    uint public pbguPrice;
    uint public frozenEther;
    uint public liquidEther;
    uint public lastThaw;
    uint public thawingDelay;
    uint public totalEtherConsumed;
    uint public totalPbguConsumed;
    uint public totalRisqBurned;

    constructor(uint _delay, address _registry) public {
        lastThaw = block.timestamp;
        thawingDelay = _delay;
        _setRegistry(_registry);
    }

    modifier onlyMGM() {
        require(
            msg.sender == registry.MGM(),
            "Only MGM can call this"
        );
        _;
    }

    /// @dev Registry owner is MTC
    modifier onlyMTC() {
        require(
            msg.sender == registry.owner(),
            "Only MTC can call this"
        );
        _;
    }

    function _setRegistry(address _registry) internal {
        registry = Registry(_registry);
        emit RegistryChange(address(registry));
    }

    /// @dev only callable by MTC
    function setRegistry(address _registry)
        external
        onlyMTC
    {
        _setRegistry(_registry);
    }

    /// @dev set price of PBGU in RISQ (base units)
    /// @dev only callable by MGM
    function setPbguPrice(uint _price)
        external
        onlyMGM
    {
        pbguPrice = _price;
        emit SetPbguPrice(_price);
    }

    function getPbguPrice() public view returns (uint) { return pbguPrice; }

    function premiumPercent() public view returns (uint) {
        if (liquidEther < 1 ether) {
            return 0;
        } else if (liquidEther >= 1 ether && liquidEther < 5 ether) {
            return 5;
        } else if (liquidEther >= 5 ether && liquidEther < 10 ether) {
            return 10;
        } else if (liquidEther >= 10 ether) {
            return 15;
        }
    }

    function payPbguInEther() external payable {
        require(
            registry.isFundFactory(msg.sender) ||
            registry.isFund(msg.sender),
            "Sender must be a fund or the factory"
        );
        uint risqPerPbgu = getPbguPrice();
        uint ethPerRisq;
        (ethPerRisq,) = priceSource().getPrice(address(risqToken()));
        uint pbguConsumed;
        if (risqPerPbgu > 0 && ethPerRisq > 0) {
            pbguConsumed = (mul(msg.value, 10 ** uint(RISQ_DECIMALS))) / (mul(ethPerRisq, risqPerPbgu));
        } else {
            pbguConsumed = 0;
        }
        totalEtherConsumed = add(totalEtherConsumed, msg.value);
        totalPbguConsumed = add(totalPbguConsumed, pbguConsumed);
        frozenEther = add(frozenEther, msg.value);
        emit PbguPaid(pbguConsumed);
    }

    /// @notice Move frozen ether to liquid pool after delay
    /// @dev Delay only restarts when this function is called
    function thaw() external {
        require(
            block.timestamp >= add(lastThaw, thawingDelay),
            "Thawing delay has not passed"
        );
        require(frozenEther > 0, "No frozen ether to thaw");
        lastThaw = block.timestamp;
        liquidEther = add(liquidEther, frozenEther);
        emit Thaw(frozenEther);
        frozenEther = 0;
    }

    /// @return ETH per RISQ including premium
    function enginePrice() public view returns (uint) {
        uint ethPerRisq;
        (ethPerRisq, ) = priceSource().getPrice(address(risqToken()));
        uint premium = (mul(ethPerRisq, premiumPercent()) / 100);
        return add(ethPerRisq, premium);
    }

    function ethPayoutForRisqAmount(uint risqAmount) public view returns (uint) {
        return mul(risqAmount, enginePrice()) / 10 ** uint(RISQ_DECIMALS);
    }

    /// @notice RISQ must be approved first
    function sellAndBurnRisq(uint risqAmount) external {
        require(registry.isFund(msg.sender), "Only funds can use the engine");
        require(
            risqToken().transferFrom(msg.sender, address(this), risqAmount),
            "RISQ transferFrom failed"
        );
        uint ethToSend = ethPayoutForRisqAmount(risqAmount);
        require(ethToSend > 0, "No ether to pay out");
        require(liquidEther >= ethToSend, "Not enough liquid ether to send");
        liquidEther = sub(liquidEther, ethToSend);
        totalRisqBurned = add(totalRisqBurned, risqAmount);
        msg.sender.transfer(ethToSend);
        risqToken().burn(risqAmount);
        emit Burn(risqAmount);
    }

    /// @dev Get RISQ from the registry
    function risqToken()
        public
        view
        returns (BurnableToken)
    {
        return BurnableToken(registry.risqToken());
    }

    /// @dev Get PriceSource from the registry
    function priceSource()
        public
        view
        returns (IPriceSource)
    {
        return IPriceSource(registry.priceSource());
    }
}

