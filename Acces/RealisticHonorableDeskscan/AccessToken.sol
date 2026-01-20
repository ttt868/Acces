
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// AEP-20 Token Standard (Access Ethereum Protocol-20)
// Compatible with ERC-20 for cross-chain functionality
interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract AccessToken is IERC20 {
    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) private _isExcludedFromFee;
    
    // حماية إعادة الدخول
    mapping(address => bool) private _inTransaction;
    
    uint256 private _totalSupply;
    string public name;
    string public symbol;
    uint8 public decimals;
    
    address public owner;
    address public feeCollector;
    
    // رسوم الغاز القابلة للتعديل
    uint256 public transferFee = 20000000000000; // 0.00002 ACCESS (في wei)
    uint256 public constant MAX_FEE = 100000000000000; // حد أقصى 0.0001 ACCESS
    
    bool public feesEnabled = true;
    bool public tradingEnabled = true;
    
    // الأحداث
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event FeeUpdated(uint256 newFee);
    event FeeCollectorUpdated(address newCollector);
    event Burn(address indexed from, uint256 value);
    event Mint(address indexed to, uint256 value);
    event TradingStatusChanged(bool enabled);
    
    // المعدلات
    modifier onlyOwner() {
        require(msg.sender == owner, "AccessToken: caller is not the owner");
        _;
    }
    
    // حماية إعادة الدخول
    modifier nonReentrant() {
        require(!_inTransaction[msg.sender], "AccessToken: reentrant call");
        _inTransaction[msg.sender] = true;
        _;
        _inTransaction[msg.sender] = false;
    }
    
    modifier whenTradingEnabled() {
        require(tradingEnabled || _isExcludedFromFee[msg.sender], "AccessToken: trading is disabled");
        _;
    }
    
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _totalSupply,
        address _feeCollector
    ) {
        name = _name;
        symbol = _symbol;
        decimals = 18;
        owner = msg.sender;
        feeCollector = _feeCollector;
        
        _totalSupply = _totalSupply * 10**decimals;
        _balances[msg.sender] = _totalSupply;
        
        // استثناء المالك ومجمع الرسوم من الرسوم
        _isExcludedFromFee[msg.sender] = true;
        _isExcludedFromFee[_feeCollector] = true;
        _isExcludedFromFee[address(this)] = true;
        
        emit Transfer(address(0), msg.sender, _totalSupply);
    }
    
    // وظائف ERC20 الأساسية
    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }
    
    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }
    
    function transfer(address recipient, uint256 amount) public override whenTradingEnabled nonReentrant returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }
    
    function allowance(address owner, address spender) public view override returns (uint256) {
        return _allowances[owner][spender];
    }
    
    function approve(address spender, uint256 amount) public override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }
    
    function transferFrom(address sender, address recipient, uint256 amount) public override whenTradingEnabled nonReentrant returns (bool) {
        uint256 currentAllowance = _allowances[sender][msg.sender];
        require(currentAllowance >= amount, "AccessToken: transfer amount exceeds allowance");
        
        _transfer(sender, recipient, amount);
        _approve(sender, msg.sender, currentAllowance - amount);
        
        return true;
    }
    
    // الوظيفة الداخلية للتحويل مع رسوم الغاز
    function _transfer(address sender, address recipient, uint256 amount) internal {
        require(sender != address(0), "AccessToken: transfer from the zero address");
        require(recipient != address(0), "AccessToken: transfer to the zero address");
        require(amount > 0, "AccessToken: transfer amount must be greater than zero");
        
        uint256 senderBalance = _balances[sender];
        uint256 transferAmount = amount;
        uint256 feeAmount = 0;
        
        // حساب رسوم الغاز
        if (feesEnabled && !_isExcludedFromFee[sender] && !_isExcludedFromFee[recipient]) {
            feeAmount = transferFee;
            require(senderBalance >= amount + feeAmount, "AccessToken: insufficient balance for transfer and fees");
        } else {
            require(senderBalance >= amount, "AccessToken: insufficient balance");
        }
        
        // خصم المبلغ ورسوم الغاز من المرسل
        _balances[sender] = senderBalance - amount - feeAmount;
        
        // إضافة المبلغ للمستقبل
        _balances[recipient] += transferAmount;
        
        // تحويل رسوم الغاز لمجمع الرسوم
        if (feeAmount > 0) {
            _balances[feeCollector] += feeAmount;
            emit Transfer(sender, feeCollector, feeAmount);
        }
        
        emit Transfer(sender, recipient, transferAmount);
    }
    
    function _approve(address owner, address spender, uint256 amount) internal {
        require(owner != address(0), "AccessToken: approve from the zero address");
        require(spender != address(0), "AccessToken: approve to the zero address");
        
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
    
    // وظائف المالك
    function transferOwnership(address newOwner) public onlyOwner {
        require(newOwner != address(0), "AccessToken: new owner is the zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
    
    // تعديل رسوم الغاز (قابل للتعديل يدوياً)
    function setTransferFee(uint256 _newFee) public onlyOwner {
        require(_newFee <= MAX_FEE, "AccessToken: fee exceeds maximum");
        transferFee = _newFee;
        emit FeeUpdated(_newFee);
    }
    
    // تفعيل/إلغاء الرسوم
    function setFeesEnabled(bool _enabled) public onlyOwner {
        feesEnabled = _enabled;
    }
    
    // تعديل مجمع الرسوم
    function setFeeCollector(address _newCollector) public onlyOwner {
        require(_newCollector != address(0), "AccessToken: invalid fee collector");
        feeCollector = _newCollector;
        emit FeeCollectorUpdated(_newCollector);
    }
    
    // استثناء من الرسوم
    function excludeFromFee(address account, bool excluded) public onlyOwner {
        _isExcludedFromFee[account] = excluded;
    }
    
    function isExcludedFromFee(address account) public view returns (bool) {
        return _isExcludedFromFee[account];
    }
    
    // تفعيل/إلغاء التداول
    function setTradingEnabled(bool _enabled) public onlyOwner {
        tradingEnabled = _enabled;
        emit TradingStatusChanged(_enabled);
    }
    
    // وظائف الحرق (Burn)
    function burn(uint256 amount) public nonReentrant {
        require(amount > 0, "AccessToken: burn amount must be greater than zero");
        require(_balances[msg.sender] >= amount, "AccessToken: insufficient balance for burn");
        
        _balances[msg.sender] -= amount;
        _totalSupply -= amount;
        
        emit Transfer(msg.sender, address(0), amount);
        emit Burn(msg.sender, amount);
    }
    
    function burnFrom(address account, uint256 amount) public nonReentrant {
        require(amount > 0, "AccessToken: burn amount must be greater than zero");
        require(_balances[account] >= amount, "AccessToken: insufficient balance for burn");
        
        uint256 currentAllowance = _allowances[account][msg.sender];
        require(currentAllowance >= amount, "AccessToken: burn amount exceeds allowance");
        
        _balances[account] -= amount;
        _totalSupply -= amount;
        _approve(account, msg.sender, currentAllowance - amount);
        
        emit Transfer(account, address(0), amount);
        emit Burn(account, amount);
    }
    
    // وظائف الصك (Mint) - للمالك فقط
    function mint(address to, uint256 amount) public onlyOwner {
        require(to != address(0), "AccessToken: mint to the zero address");
        require(amount > 0, "AccessToken: mint amount must be greater than zero");
        
        _totalSupply += amount;
        _balances[to] += amount;
        
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }
    
    // وظائف الطوارئ
    function emergencyTransfer() public onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            payable(owner).transfer(balance);
        }
    }
    
    function emergencyTokenTransfer(address token, uint256 amount) public onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
    
    // وظائف المعلومات
    function getTokenInfo() public view returns (
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        uint256 _totalSupply,
        address _owner,
        address _feeCollector,
        uint256 _transferFee,
        bool _feesEnabled,
        bool _tradingEnabled
    ) {
        return (
            name,
            symbol,
            decimals,
            _totalSupply,
            owner,
            feeCollector,
            transferFee,
            feesEnabled,
            tradingEnabled
        );
    }
    
    // دعم استقبال ETH
    receive() external payable {}
    fallback() external payable {}
}
