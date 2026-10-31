// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title SiriusTestUsdc
/// @notice Jeton de règlement pour les réseaux de test uniquement.
///
/// @dev Il existe parce qu'aucun USDC du testnet Mezo n'est obtenable : celui qui
///      est vérifié réserve sa frappe à son propriétaire, et le faucet n'en distribue
///      pas. Sans jeton, aucun prêt ne peut être verrouillé et le protocole est
///      indémontrable.
///
///      Dix-huit décimales, pour correspondre à l'USDC vérifié de cette chaîne — et
///      donc à ce que `USDC_DECIMALS_BY_NETWORK` déclare pour le testnet. Un jeton à
///      dix-huit décimales imposerait de changer cette table et rendrait la démonstration
///      moins fidèle au réseau visé.
///
///      La frappe est ouverte à tous, délibérément : sur un réseau de test, un contrôle
///      d'accès n'ajoute aucune sécurité et ajoute une clé à conserver. Ce contrat n'a
///      donc rien à faire sur un mainnet, et `SiriusEscrow` y pointerait vers l'USDC
///      réel.
contract SiriusTestUsdc {
    string public constant name = "Sirius Test USDC";
    string public constant symbol = "MUSD";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    /// @notice Nonces EIP-2612 : un `permit` par valeur, consommé dans l'ordre.
    mapping(address => uint256) public nonces;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidRecipient();
    error PermitExpired();
    error InvalidPermitSignature();

    /// @notice Frappe des jetons de test. Ouvert à tous : réseau de test uniquement.
    function mint(address to, uint256 amount) external {
        if (to == address(0)) revert InvalidRecipient();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Domaine EIP-712 du `permit`, recalculé à chaque lecture pour suivre le chainId.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256("1"), block.chainid, address(this)));
    }

    /// @notice Approbation par signature (EIP-2612), le même contrat que le MUSD canonique
    ///         expose sur Mezo. Permet à l'escrow de tester `lockWithSignature` en local.
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
    {
        if (block.timestamp > deadline) revert PermitExpired();
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != owner) revert InvalidPermitSignature();
        allowance[owner][spender] = value;
        emit Approval(owner, spender, value);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 approved = allowance[from][msg.sender];
        if (approved < amount) revert InsufficientAllowance();
        // Une allocation infinie n'est pas décrémentée : c'est la convention ERC-20
        // répandue, et l'escrow s'en sert pour éviter une écriture par prêt.
        if (approved != type(uint256).max) allowance[from][msg.sender] = approved - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidRecipient();
        uint256 solde = balanceOf[from];
        if (solde < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = solde - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}
