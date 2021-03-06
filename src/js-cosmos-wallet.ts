  // Import here Polyfills if needed. Recommended core-js (npm i -D core-js)
  // import "core-js/fn/array.find"
  // ...
  const bip39 = require(`bip39`)
  const bip32 = require(`bip32`)
  const bech32 = require(`bech32`)
  const secp256k1 = require(`secp256k1`)
  const sha256 = require("crypto-js/sha256")
  const ripemd160 = require("crypto-js/ripemd160")
  const CryptoJS = require("crypto-js")
  
  const hdPathAtom = `m/44'/118'/0'/0/0` // key controlling ATOM allocation
  
  const standardRandomBytesFunc = (x: any) => CryptoJS.lib.WordArray.random(x).toString()
  
  export function generateWalletFromSeed(mnemonic: any) {
    const masterKey = deriveMasterKey(mnemonic)
    const { privateKey, publicKey } = deriveKeypair(masterKey)
    const cosmosAddress = createCosmosAddress(publicKey)
    return {
      privateKey: privateKey.toString(`hex`),
      publicKey: publicKey.toString(`hex`),
      cosmosAddress
    }
  }
  
  export function generateSeed(randomBytesFunc = standardRandomBytesFunc) {
    const randomBytes = Buffer.from(randomBytesFunc(32), `hex`)
    if (randomBytes.length !== 32) throw Error(`Entropy has incorrect length`)
    const mnemonic = bip39.entropyToMnemonic(randomBytes.toString(`hex`))
  
    return mnemonic
  }
  
  export function generateWallet(randomBytesFunc = standardRandomBytesFunc) {
    const mnemonic = generateSeed(randomBytesFunc)
    return generateWalletFromSeed(mnemonic)
  }
  
  // NOTE: this only works with a compressed public key (33 bytes)
  export function createCosmosAddress(publicKey: any) {
    const message = CryptoJS.enc.Hex.parse(publicKey.toString(`hex`))
    const hash = ripemd160(sha256(message)).toString()
    const address = Buffer.from(hash, `hex`)
    const cosmosAddress = bech32ify(address, `bitsong`)
  
    return cosmosAddress
  }
  
  function deriveMasterKey(mnemonic: any) {
    // throws if mnemonic is invalid
    bip39.validateMnemonic(mnemonic)
  
    const seed = bip39.mnemonicToSeed(mnemonic)
    const masterKey = bip32.fromSeed(seed)
    return masterKey
  }
  
  function deriveKeypair(masterKey: any) {
    const cosmosHD = masterKey.derivePath(hdPathAtom)
    const privateKey = cosmosHD.privateKey
    const publicKey = secp256k1.publicKeyCreate(privateKey, true)
  
    return {
      privateKey,
      publicKey
    }
  }
  
  function bech32ify(address: any, prefix: any) {
    const words = bech32.toWords(address)
    return bech32.encode(prefix, words)
  }
  
  // Transactions often have amino decoded objects in them {type, value}.
  // We need to strip this clutter as we need to sign only the values.
  export function prepareSignBytes(jsonTx: any): any {
    if (Array.isArray(jsonTx)) {
      return jsonTx.map(prepareSignBytes)
    }
  
    // string or number
    if (typeof jsonTx !== `object`) {
      return jsonTx
    }
  
    let sorted = {}
    Object.keys(jsonTx)
      .sort()
      .forEach(key => {
        if (jsonTx[key] === undefined || jsonTx[key] === null) return
  
        (sorted as any)[key] = prepareSignBytes(jsonTx[key])
      })
    return sorted
  }
  
  /*
  The SDK expects a certain message format to serialize and then sign.
  
  type StdSignMsg struct {
    ChainID       string      `json:"chain_id"`
    AccountNumber uint64      `json:"account_number"`
    Sequence      uint64      `json:"sequence"`
    Fee           auth.StdFee `json:"fee"`
    Msgs          []sdk.Msg   `json:"msgs"`
    Memo          string      `json:"memo"`
  }
  */
  export function createSignMessage(
    jsonTx: any,
    { sequence, account_number, chain_id }:{sequence: any, account_number: any, chain_id: any}
  ) {
    // sign bytes need amount to be an array
    const fee = {
      amount: jsonTx.fee.amount || [],
      gas: jsonTx.fee.gas
    }

    return JSON.stringify(
      prepareSignBytes({
        fee,
        memo: jsonTx.memo,
        msgs: jsonTx.msg, // weird msg vs. msgs
        sequence,
        account_number,
        chain_id
      })
    )
  }
  
  // produces the signature for a message (returns Buffer)
  export function signWithPrivateKey(signMessage: any, privateKey: any) {
    const signHash = Buffer.from(sha256(signMessage).toString(), `hex`)
    const { signature } = secp256k1.sign(signHash, Buffer.from(privateKey, `hex`))
    return signature
  }
  
  export function createSignature(
    signature: any,
    publicKey: any
  ) {
    return {
      signature: signature.toString(`base64`),
      pub_key: {
        type: `tendermint/PubKeySecp256k1`, // TODO: allow other keytypes
        value: publicKey.toString(`base64`)
      }
    }
  }

  // main function to sign a jsonTx using the local keystore wallet
  // returns the complete signature object to add to the tx
  export function sign(jsonTx: any, wallet: any, requestMetaData: any) {
    const signMessage = createSignMessage(jsonTx, requestMetaData)
    const signatureBuffer = signWithPrivateKey(signMessage, wallet.privateKey)
    const pubKeyBuffer = Buffer.from(wallet.publicKey, `hex`)
    return createSignature(
      signatureBuffer,
      pubKeyBuffer
    )
  }
  
  // adds the signature object to the tx
  export function createSignedTx(tx: any, signature: any) {
    return Object.assign({}, tx, {
      signatures: [signature]
    })
  }
  
  // the broadcast body consists of the signed tx and a return type
  export function createBroadcastBody(signedTx: any) {
    return JSON.stringify({
      tx: signedTx,
      return: `block`
    })
  }

