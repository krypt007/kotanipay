'use strict';

// Firebase init
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const firestore = admin.firestore();
require('dotenv').config();

// Express and CORS middleware init
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const mpesaApp = express();
mpesaApp.use(cors({ origin: true }));
mpesaApp.use(bodyParser.json());
mpesaApp.use(bodyParser.urlencoded({ extended: true }));

const PNF = require('google-libphonenumber').PhoneNumberFormat;
const phoneUtil = require('google-libphonenumber').PhoneNumberUtil.getInstance();
const axios = require("axios");

const Mpesa = require('mpesa-node');
const mpesaApi = new Mpesa({ 
  consumerKey: functions.config().env.mpesa.consumer.key,
  consumerSecret: functions.config().env.mpesa.consumer.secret,
  environment: functions.config().env.mpesa.env,
  shortCode: functions.config().env.mpesa.shortcode,
  initiatorName: functions.config().env.mpesa.initiator_name,
  lipaNaMpesaShortCode: functions.config().env.mpesa.lnm.shortcode,
  lipaNaMpesaShortPass: functions.config().env.mpesa.lnm.shortpass,
  securityCredential: functions.config().env.mpesa.security_creds
});


const prettyjson = require('prettyjson');
var options = { noColor: true };

var randomstring = require("randomstring");
var tinyURL = require('tinyurl');

const iv = functions.config().env.crypto_iv.key;
const enc_decr_fn = functions.config().env.algo.enc_decr;
const  phone_hash_fn = functions.config().env.algo.msisdn_hash;

// AFRICASTALKING API
const AT_credentials = {
    apiKey: functions.config().env.at_api.key,
    username: functions.config().env.at_api.usename
}

const AfricasTalking = require('africastalking')(AT_credentials);
const sms = AfricasTalking.SMS;

// CElO init
const contractkit = require('@celo/contractkit');
const { isValidPrivate, privateToAddress, privateToPublic, pubToAddress, toChecksumAddress } = require ('ethereumjs-util');
const bip39 = require('bip39-light');
const crypto = require('crypto');

const NODE_URL = 'https://celo-alfajores.datahub.figment.network/apikey/b2b43afb38d9a896335580452e687e53/'; //'https://baklava-forno.celo-testnet.org'
const kit = contractkit.newKit(NODE_URL);

const trimLeading0x = (input) => (input.startsWith('0x') ? input.slice(2) : input);
const ensureLeading0x = (input) => (input.startsWith('0x') ? input : `0x${input}`);
const hexToBuffer = (input) => Buffer.from(trimLeading0x(input), 'hex');

// GLOBAL VARIABLES
// let publicAddress = '';
let senderMSISDN = ``;
let receiverMSISDN = ``;
var recipientId = ``;
var senderId = ``;
let amount = ``;



// USSD API 
app.post("/", async (req, res) => {
    // Read variables sent via POST from our SDK
    const { sessionId, serviceCode, phoneNumber, text } = req.body;
    let response = '';    
    var data = text.split('*');

    if (text == '') {
        // This is the first request. Note how we start the response with CON
        response = `CON Welcome to Kotanipay.
        1. Send Money 
        2. Deposit Funds       
        3. Withdraw Cash 
        6. PayBill or Buy Goods 
        7. My Account`;
    }     
    
    //  1. TRANSFER FUNDS #SEND MONEY
    else if ( data[0] == '1' && data[1] == null) { 
        response = `CON Enter Recipient`;
    } else if ( data[0] == '1' && data[1]!== '' && data[2] == null) {  //  TRANSFER && PHONENUMBER
        response = `CON Enter Amount to Send:`;
        
    } else if ( data[0] == '1' && data[1] !== '' && data[2] !== '' ) {//  TRANSFER && PHONENUMBER && AMOUNT
        senderMSISDN = phoneNumber.substring(1);
        console.log('sender: ', senderMSISDN);
        try {
          const recnumber = phoneUtil.parseAndKeepRawInput(`${data[1]}`, 'KE');
          receiverMSISDN = phoneUtil.format(recnumber, PNF.E164);
        } catch (error) {
          console.log(error); 
        }

        receiverMSISDN = receiverMSISDN.substring(1);       
        amount = data[2];
        senderId = await getSenderId(senderMSISDN)
        console.log('senderId: ', senderId);
        recipientId = await getRecipientId(receiverMSISDN)
        console.log('recipientId: ', recipientId);

        // Check if users exists in API Database:
        let senderstatusresult = await checkIfSenderExists(senderId);
        console.log("Sender Exists? ",senderstatusresult);
        if(senderstatusresult == false){ await createNewUser(senderId, senderMSISDN) }

        let recipientstatusresult = await checkIfRecipientExists(recipientId);
        console.log("Recipient Exists? ",recipientstatusresult);
        if(recipientstatusresult == false){ await createNewUser(recipientId, receiverMSISDN) }  
        
        // Retrieve User Blockchain Data
        let senderInfo = await getSenderDetails(senderId);
        let senderprivkey = await getSenderPrivateKey(senderInfo.data().seedKey, senderMSISDN, iv)
        let receiverInfo = await getReceiverDetails(recipientId);

        let hash = await transfercUSD(senderInfo.data().publicAddress, senderprivkey, receiverInfo.data().publicAddress, amount);
        let url = await getTxidUrl(hash);
        let message2sender = `KES ${amount}  sent to ${receiverMSISDN} Celo Account.
          Transaction URL:  ${url}`;
        let message2receiver = `You have received KES ${amount} from ${senderMSISDN} Celo Account.
        Transaction Link:  ${url}`;
        console.log('tx URL', url);
        // sendMessage("+"+senderMSISDN, message2sender);
        // sendMessage("+"+receiverMSISDN, message2receiver);

        response = `END KES `+amount+` sent to `+receiverMSISDN+` Celo Account
        => Transaction Details: ${url}`;        
    } 
    
//  2. DEPOSIT FUNDS
    else if ( data[0] == '2' && data[1] == null) { 
        response = `CON Enter Amount to Deposit`;
    } else if ( data[0] == '2' && data[1]!== '') {  //  DEPOSIT && AMOUNT
        let depositMSISDN = phoneNumber.substring(1);  // phoneNumber to send sms notifications
        amount = `${data[1]}`;
        mpesaSTKpush(depositMSISDN, data[1]);   //calling mpesakit library 
        console.log('callling STK push');
        response = `END Depositing KES:  `+amount+` to `+depositMSISDN+` Celo Account`;
    }

//  3. WITHDRAW FUNDS
    else if ( data[0] == '3'  && data[1] == null) {
        response = `CON Enter Amount to Withdraw`;
    }else if ( data[0] == '3' && data[1]!== '') {  //  WITHDRAW && AMOUNT
        senderMSISDN = phoneNumber.substring(1);  // phoneNumber to send sms notifications
        console.log('Phonenumber: ', senderMSISDN);        
        amount = `${data[1]}`;
        console.log('Amount to Withdraw: KES.', data[1]);     // const amount = data[1];  
        mpesa2customer(senderMSISDN, data[1])    //calling mpesakit library  

        response = `END You have withdrawn KES: `+data[1]+` from account: `+phoneNumber.substring(1);        
    }

//  5. KOTANI DEX
    else if ( data[0] == '5' && data[1] == null) {
      // Business logic for first level response
      response = `CON Choose Investment Option
      1. Buy/Sell CELO
      2. Buy/Sell BITCOIN
      3. Buy/Sell ETHEREUM
      4. Buy/Sell EOS`;
  }else if ( data[0] == '5' && data[1] == '1') {
      let userMSISDN = phoneNumber.substring(1);
      response = await getAccDetails(userMSISDN);        
  }else if ( data[0] == '5'  && data[1] == '2') {
      let userMSISDN = phoneNumber.substring(1);
      response = `END Coming soon`;        
  }else if ( data[0] == '5'  && data[1] == '3') {
    let userMSISDN = phoneNumber.substring(1);
    response = `END Coming soon`;        
}else if ( data[0] == '5'  && data[1] == '4') {
  let userMSISDN = phoneNumber.substring(1);
  response = `END Coming soon`;        
}

//  6. PAYBILL or BUY GOODS
    else if ( data[0] == '6' && data[1] == null) {
      // Business logic for first level response
      response = `CON Select Option:
      1. Buy Airtime
      2. PayBill
      3. Buy Goods`;
  }
  //  6.1: BUY AIRTIME
  else if ( data[0] == '6' && data[1] == '1' && data[2] == null) { //  REQUEST && AMOUNT
      response = `CON Enter Amount:`;       
  }else if ( data[0] == '6' && data[1] == '1' && data[2]!== '') { 
      response = `END Buying KES ${data[2]} worth of airtime for: `+phoneNumber;        
  }

  //  6.2: PAY BILL  
  else if ( data[0] == '6' && data[1] == '2') {
      response = `END PayBill feature Coming soon`;        
  }

  //  6.1: BUY GOODS
  else if ( data[0] == '6'  && data[1] == '3') {
      let userMSISDN = phoneNumber.substring(1);
      response = `END BuyGoods feature Coming soon`;        
  }

        

//  7. ACCOUNT DETAILS
    else if ( data[0] == '7' && data[1] == null) {
        // Business logic for first level response
        response = `CON Choose account information you want to view
        1. Account Details
        2. Account balance
        3. Account Backup`;
    }else if ( data[0] == '7' && data[1] == '1') {
        let userMSISDN = phoneNumber.substring(1);
        response = await getAccDetails(userMSISDN);        
    }else if ( data[0] == '7'  && data[1] == '2') {
        let userMSISDN = phoneNumber.substring(1);
        response = await getAccBalance(userMSISDN);        
    }else if ( data[0] == '7'  && data[1] == '3') {
      let userMSISDN = phoneNumber.substring(1);
      response = await getSeedKey(userMSISDN);        
  }
  else{
    // text == '';
    response = `END Sorry, I dont understand your option`;
  }

    res.set('Content-Type: text/plain');
    res.send(response);
    // DONE!!!
});

  // MPESA CALLBACK POST / method
mpesaApp.post("/lipanampesa/success", async (req, res) => {
  // GLOBAL VARIABLES
  let responseBody = "";
  let statusCode = 0;
  let publicAddress = '';
  let senderMSISDN = ``;
  let receiverMSISDN = ``;
  var recipientId = ``;
  var senderId = ``;
  let amount = ``;

  // var options = { noColor: true };
  console.log('-----------LNM VALIDATION RESPONSE-----------');
  console.log(prettyjson.render(req.body, options));
  let callbackjson = req.body;
  let callbackdata = callbackjson.Body.stkCallback.CallbackMetadata.Item;
  console.log('STK Push Data=> ',callbackdata); 

  // const url = "https://yqrhogsjk3.execute-api.eu-central-1.amazonaws.com/qa/mpesacallback/lipanampesa/success";  
  // // Forward Callback Response to Lambda
  // axios.post(url, callbackdata).then(response => {console.log('Response from AWS: ',response.status)})
  let depositMSISDN = `${callbackdata[4].Value}`;  // phoneNumber to send sms notifications
  console.log('Deposit Phonenumber fron STK: ', depositMSISDN); 

  const escrowMSISDN = '254728128696';
  senderMSISDN = escrowMSISDN;
  console.log('sender: ', senderMSISDN);

  receiverMSISDN = depositMSISDN; 
  console.log('receiver: ', receiverMSISDN);
  amount = `${callbackdata[0].Value}`;
  console.log('Amount to send fron STK: KES.', amount);  

  senderId = await getSenderId(senderMSISDN)
  console.log('EscrowId: ', senderId);
  recipientId = await getRecipientId(receiverMSISDN)
  console.log('recipientId: ', recipientId);

  // let senderstatusresult = await checkIfSenderExists(senderId);
  // console.log("Sender Exists? ",senderstatusresult);
  // if(senderstatusresult == false){ createNewUser(senderId, senderMSISDN) }

  let recipientstatusresult = await checkIfRecipientExists(recipientId);
  console.log("Recipient Exists? ",recipientstatusresult);
  if(recipientstatusresult == false){ createNewUser(recipientId, receiverMSISDN) }  
  
  // Retrieve User Blockchain Data
  let senderInfo = await getSenderDetails(senderId);
  console.log('Sender info from DB=>',senderInfo.data());
  let senderprivkey = await getSenderPrivateKey(senderInfo.data().seedKey, senderMSISDN, iv)
  let receiverInfo = await getReceiverDetails(recipientId);
  console.log('Receiver info fromDB=>',receiverInfo.data());

  let hash = await transfercUSD(senderInfo.data().publicAddress, senderprivkey, receiverInfo.data().publicAddress, amount);
  let url = await getTxidUrl(hash);
  let message2sender = `KES ${amount}  sent to ${receiverMSISDN} Celo Account.
    Transaction URL:  ${url}`;
  let message2receiver = `You have deposited KES ${amount} to your Celo Account.
  Transaction Link:  ${url}`;
  console.log('tx URL', url);
  // sendMessage("+"+senderMSISDN, message2sender);
  // sendMessage("+"+receiverMSISDN, message2receiver);
  res.send('Mpesa Deposit complete');
}); 

    
mpesaApp.post('/b2c/result', (req, res) => {
    console.log('-----------B2C CALLBACK------------');
    console.log(prettyjson.render(req.body, options));

    console.log('-----------------------');

    let message = {
        "ResponseCode": "00000000",
        "ResponseDesc": "success"
    };
    res.json(message);
});

mpesaApp.post('/b2c/timeout', (req, res) => {
    console.log('-----------B2C TIMEOUT------------');
    console.log(prettyjson.render(req.body, options));
    console.log('-----------------------');

    let message = {
        "ResponseCode": "00000000",
        "ResponseDesc": "success"
    };
    res.json(message);
});

mpesaApp.post('/c2b/validation', (req, res) => {
    console.log('-----------C2B VALIDATION REQUEST-----------');
    console.log(prettyjson.render(req.body, options));
    console.log('-----------------------');

    let message = {
        "ResultCode": 0,
        "ResultDesc": "Success",
        "ThirdPartyTransID": "1234567890"
    };
    res.json(message);
});

mpesaApp.post('/c2b/confirmation', (req, res) => {
    console.log('-----------C2B CONFIRMATION REQUEST------------');
    console.log(prettyjson.render(req.body, options));
    console.log('-----------------------');

    let message = {
        "ResultCode": 0,
        "ResultDesc": "Success"
    };
    res.json(message);
});

mpesaApp.post('/b2b/result', (req, res) => {
    console.log('-----------B2B CALLBACK------------');
    console.log(prettyjson.render(req.body, options));
    console.log('-----------------------');

    let message = {
        "ResponseCode": "00000000",
        "ResponseDesc": "success"
    };

    res.json(message);
});

mpesaApp.post('/b2b/timeout', (req, res) => {
    console.log('-----------B2B TIMEOUT------------');
    console.log(prettyjson.render(req.body, options));
    console.log('-----------------------');

    let message = {
        "ResponseCode": "00000000",
        "ResponseDesc": "success"
    };

    res.json(message);
});

mpesaApp.post("/b2c/success", async (req, res) => { 
    const data = req.body;
    console.log('B2C Data: ',data);
    res.send('B2C Request Received'); 
})

mpesaApp.post("/", async (req, res) => {
    //var options = { noColor: true };
    // Read variables sent via POST from our SDK
    console.log(req.body);
    // const data = req.body;
    // console.log(data);
    res.send('Invalid Request Received');
})
    


// FUNCTIONS
function sendMessage(to, message) {
    const params = {
        to: [to],
        message: message,
        from: 'KotaniPay'
    }  
    console.log('Sending sms to user')
    sms.send(params)
        .then(msg=>console.log(prettyjson.render(msg, options)))
        .catch(console.log);
}

function arraytojson(item, index, arr) {
  //arr[index] = item.split('=').join('": "');
  arr[index] = item.replace(/=/g, '": "');
  //var jsonStr2 = '{"' + str.replace(/ /g, '", "').replace(/=/g, '": "') + '"}';
}

function stringToObj (string) {
  var obj = {}; 
  var stringArray = string.split('&'); 
  for(var i = 0; i < stringArray.length; i++){ 
    var kvp = stringArray[i].split('=');
    if(kvp[1]){
      obj[kvp[0]] = kvp[1] 
    }
  }
  return obj;
}


//USSD APP
async function getAccBalance(userMSISDN){

  console.log(userMSISDN);
  let userId  = await getSenderId(userMSISDN)
  console.log('UserId: ', userId)

  let userstatusresult = await checkIfSenderExists(userId);
  console.log("User Exists? ",userstatusresult);
  if(userstatusresult == false){ await addUserDataToDB(userId, userMSISDN); 
    console.log('creating user acoount');
  }    
  
  let userInfo = await getSenderDetails(userId);
  console.log('User Address => ', userInfo.data().publicAddress);
  
  const stableTokenWrapper = await kit.contracts.getStableToken()
  let cUSDBalance = await stableTokenWrapper.balanceOf(userInfo.data().publicAddress) // In cUSD
  cUSDBalance = kit.web3.utils.fromWei(cUSDBalance.toString(), 'ether');
  console.info(`Account balance of ${cUSDBalance.toString()}`)

  const goldTokenWrapper = await kit.contracts.getGoldToken()
  let cGoldBalance = await goldTokenWrapper.balanceOf(userInfo.data().publicAddress) // In cGLD
  cGoldBalance = kit.web3.utils.fromWei(cGoldBalance.toString(), 'ether');    
  console.info(`Account balance of ${cGoldBalance.toString()}`)

  return `END Your Account Balance is:
            Kenya Shillings: ${cUSDBalance*100}`;
}

async function getAccDetails(userMSISDN){
  console.log(userMSISDN);
  let userId = await getSenderId(userMSISDN);
  let userstatusresult = await checkIfSenderExists(userId);
  console.log("User Exists? ",userstatusresult);
  if(userstatusresult == false){ await addUserDataToDB(userId, userMSISDN) }      
  
  let userInfo = await getSenderDetails(userId);
  console.log('User Address => ', userInfo.data().publicAddress);
  let url = await getAddressUrl(`${userInfo.data().publicAddress}`)
  console.log('Address: ',url);            
  return `END Your Account Number is: ${userMSISDN}
              ...Account Address is: ${url}`;
}

async function getSenderPrivateKey(seedCypher, senderMSISDN, iv){
  try {
    let senderSeed = await decryptcypher(seedCypher, senderMSISDN, iv);
    console.log('Sender seedkey=>',senderSeed);
    let senderprivkey =  `${await generatePrivKey(senderSeed)}`;
    return new Promise(resolve => {  
      resolve (senderprivkey)        
    }); 
  }catch(err){console.log('Unable to decrypt cypher')}
}

async function getSeedKey(userMSISDN){
  console.log(userMSISDN);
  let userId = await getSenderId(userMSISDN);
  console.log('User Id: ', userId)

  let userstatusresult = await checkIfSenderExists(userId);
  console.log("User Exists? ",userstatusresult);
  if(userstatusresult == false){ await addUserDataToDB(userId, userMSISDN) }      
  
  let userInfo = await getSenderDetails(userId);
  console.log('SeedKey => ', userInfo.data().seedKey);
          
  return `END Your Backup Phrase is: ${userInfo.data().seedKey}`;
}

async function USSDgetAccountDetails(phoneNumber){
  let userMSISDN = phoneNumber;
  console.log('PhoneNumber: ', userMSISDN)
  let userId = await getRecipientId(userMSISDN)
  let accAddress = await getReceiverDetails(userId)
  console.log('@Celo Address:',accAddress)
  // let userAddress = '0x9f5675c3b3af6e7b93f71f0c5821ae9b4155afcf';
  let url = await getAddressUrl(accAddress)
  console.log('Address: ',url);            
  return `END Your Account Number is: ${userMSISDN}
              ...Account Address is: ${url}`;
}

async function transfercGOLD(senderId, recipientId, amount){
    try{
      let senderInfo = await getSenderDetails(senderId);
      console.log('Sender Adress: ',  senderInfo.data().SenderAddress);
      //console.log('Sender seedkey: ', senderInfo.seedKey);
      let senderprivkey =  `${await generatePrivKey(senderInfo.data().seedKey)}`;
      console.log('Sender Private Key: ',senderprivkey)
      let receiverInfo = await getReceiverDetails(recipientId);
      console.log('Receiver Adress: ', receiverInfo.data().publicAddress);      
      let cGLDAmount = `${amount*10000000}`;
      console.log('cGOLD Amount: ', cGLDAmount)
      sendcGold(`${senderInfo.data().publicAddress}`, `${receiverInfo.data().publicAddress}`, cGLDAmount, senderprivkey)
    }
    catch(err){console.log(err)}
}
  
async function transfercUSDx(senderId, recipientId, amount){
    try{
      let senderInfo = await getSenderDetails(senderId);
      console.log('senderInfo: ', senderInfo.data())
      // let senderprivkey =  `${await generatePrivKey(senderInfo.seedKey)}`;
      // console.log('Sender Private Key: ',senderprivkey)
      // console.log('Sender Adress: ', senderInfo.SenderAddress);
      // //console.log('Sender seedkey: ', senderInfo.seedKey);
      // let receiverInfo = await getReceiverDetails(recipientId);
      // console.log('Receiver Adress: ', receiverInfo.receiverAddress);
      // let cUSDAmount = amount*0.01;
      // console.log('cUSD Amount: ', cUSDAmount);
      // return sendcUSD(`${senderInfo.SenderAddress}`, `${receiverInfo.receiverAddress}`, cUSDAmount, senderprivkey);
    }
    catch(err){console.log(err)}
  }

async function transfercUSD(sender, senderprivkey, receiver, amount){
  try{
    console.log('Sender Private Key: ',senderprivkey);    
    console.log('Sender Adress: ', sender);
    console.log('Receiver Adress: ', receiver);
    let cUSDAmount = amount*0.01;
    console.log('cUSD Amount: ', cUSDAmount);
    return sendcUSD(`${sender}`, `${receiver}`, cUSDAmount, `${senderprivkey}`);
  }
  catch(err){console.log(err)}
}    


function getPinFromUser(){
  return new Promise(resolve => {    
    let loginpin = randomstring.generate({ length: 5, charset: 'numeric' });
    resolve (loginpin);
  });
}
  
async function addUserDataToDB(userId, userMSISDN){ 
  try {
    console.log('user ID: ', userId)
    let loginpin = await generateLoginPin(); 
    console.log('Login pin=> ', loginpin);
    let mnemonic = await bip39.generateMnemonic(256);
    var enc_seed = await createcypher(mnemonic, userMSISDN, iv);
    console.log('Encrypted seed=> ', enc_seed);
    let publicAddress = await getPublicAddress(mnemonic);
    console.log('Public Address: ', publicAddress); 

    const newAccount = {
        'seedKey' : `${enc_seed}`,
        'publicAddress' : `${publicAddress}`,
        'userLoginPin' : loginpin
    };

    let db = firestore.collection('accounts').doc(userId);
    db.set(newAccount).then(newDoc => {console.log("Document Created:\n", newDoc.id)})
    // // signupDeposit(publicAddress);
  } catch (err) {
    console.log(err);
  }
  return true; 
}

async function signupDeposit(publicAddress){
  let escrowMSISDN = functions.config().env.escrow.msisdn;
  console.log('Escrow: ', escrowMSISDN);
  let amount = 10;
  console.log('Amount: ', amount);
  let escrowId = await getSenderId(escrowMSISDN);
  console.log('EscrowId: ', escrowId);

  let escrowInfo = await getSenderDetails(escrowId);
  console.log('Escrow Sender Address => ', escrowInfo.data().publicAddress);

  // let senderSeed = await decryptcypher(senderInfo.data().seedKey, escrowMSISDN, iv);
  console.log(`Seed Cypher:  ${escrowInfo.data().seedKey}`);
  // let senderprivkey =  `${await generatePrivKey(senderSeedKey)}`;
  let seedkey = await decryptcypher(escrowInfo.data().seedKey, escrowMSISDN, iv)
  console.log(`Privatekey:  ${seedkey}`);
  let senderprivkey = await getSenderPrivateKey(seedkey, escrowMSISDN, iv)
  console.log(`Privatekey:  ${senderprivkey}`);

  let hash = await transfercUSD(escrowInfo.data().publicAddress, senderprivkey, publicAddress, amount)
  let url = await getTxidUrl(hash);
  console.log('Transaction URL: ',url)
}  


function getEncryptKey(userMSISDN){    
  const crypto = require('crypto');
  const hash_fn = functions.config().env.algo.key_hash;
  console.log('Hash Fn',hash_fn);
  let key = crypto.createHash(hash_fn).update(userMSISDN).digest('hex');
  return key;
}

async function createcypher(text, userMSISDN, iv){
  const crypto = require('crypto');
  console.log('cypher Phonenumber', userMSISDN);
  let key = await getEncryptKey(userMSISDN);
  console.log('Encrypt key', key);
  console.log('IV: ', iv);
  const cipher = crypto.createCipher('aes192',  key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  console.log(encrypted);
  return encrypted; 
}
  
async function decryptcypher(encrypted, userMSISDN, iv){    
  const crypto = require('crypto');
  let key = await getEncryptKey(userMSISDN);
  console.log('Decrypt key', key);
  console.log('IV', iv);
  // const encrypted = cyphertext;

  const decipher = crypto.createDecipher('aes192', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  // console.log(decrypted);
  return decrypted;
}
      
  
async function getSenderDetails(senderId){
  let db = firestore.collection('accounts').doc(senderId);
  let result = await db.get();
  return result;    
}
  
   
  //SEND GET shortURL
  async function getTxidUrl(txid){
     return await getSentTxidUrl(txid);
  }
  
  function getSentTxidUrl(txid){      
      return new Promise(resolve => {    
          const sourceURL = `https://alfajores-blockscout.celo-testnet.org/tx/${txid}/token_transfers`;
          resolve (tinyURL.shorten(sourceURL))        
      });
  }
  
  //GET ACCOUNT ADDRESS shortURL
  async function getAddressUrl(userAddress){
      return await getUserAddressUrl(userAddress);
  }
  
  function getUserAddressUrl(userAddress){
    return new Promise(resolve => {    
        const sourceURL = `https://alfajores-blockscout.celo-testnet.org/address/${userAddress}/tokens`;
        resolve (tinyURL.shorten(sourceURL));
      });   
  }
    
  async function getReceiverDetails(recipientId){    
    let db = firestore.collection('accounts').doc(recipientId);
    let result = await db.get();
    return result;
  }
  
  function parseMsisdn(userMSISDN){
    try {
        e64phoneNumber = parsePhoneNumber(`${userMSISDN}`, 'KE')  
        console.log(e64phoneNumber.number)    
    } catch (error) {
        if (error instanceof ParseError) {
            // Not a phone number, non-existent country, etc.
            console.log(error.message)
        } else {
            throw error
        }
    }
    return e64phoneNumber.number;    
  }
  
  function getSenderId(senderMSISDN){
    return new Promise(resolve => {
      let senderId = crypto.createHash(phone_hash_fn).update(senderMSISDN).digest('hex');
      resolve(senderId);
    });
  } 
    
  function getRecipientId(receiverMSISDN){
    return new Promise(resolve => {
        let recipientId = crypto.createHash(phone_hash_fn).update(receiverMSISDN).digest('hex');
        resolve(recipientId);
    });
  } 
  
  async function checkIfSenderExists(senderId){      
    return await checkIfUserExists(senderId);
  }
  
  async function checkIfRecipientExists(recipientId){    
    return await checkIfUserExists(recipientId);
  }

  async function checkIfUserExists(userId){
    var exists;         
    return new Promise(resolve => {
      admin.auth().getUser(userId)
        .then(function(userRecord) {          
            if (userRecord) {
                console.log('Successfully fetched user data:', userRecord.uid);
                exists = true;
                resolve (exists);
            } else {
              console.log("Document", userId, "does not exists:\n");
              exists = false;
              resolve (exists);
            }
        })
        .catch(function(error) {
            console.log('Error fetching user data:', userId, "does not exists:\n");
            exists = false;
            resolve (exists);
        });
    });    
}  

function createNewUser(userId, userMSISDN){
  return new Promise(resolve => {
      admin.auth().createUser({
          uid: userId,
          phoneNumber: `+${userMSISDN}`
      })
      .then(function(userRecord) {
          console.log('Successfully created new user:', userRecord.uid);
      })
      .catch(function(error) {
          console.log('Error creating new user:', error);
      });
  });  
}
        
  function generateLoginPin(){
    return new Promise(resolve => {
      resolve (randomstring.generate({ length: 5, charset: 'numeric' }));
    });
  }     
    
    
  //MPESA LIBRARIES
  async function mpesaSTKpush(phoneNumber, amount){
    const accountRef = Math.random().toString(35).substr(2, 7);
    const URL = 'https://us-central1-yehtu-1de60.cloudfunctions.net/mpesaCallback';
    try{
      let result = await mpesaApi.lipaNaMpesaOnline(phoneNumber, amount, URL + '/lipanampesa/success', accountRef);
      console.log("status: ", result.status);
      console.log('Data => ', result.data);
    }
    catch(err){
        console.log(err)
    }
  }
  
  async function mpesa2customer(phoneNumber, amount){  
      const URL = 'https://us-central1-yehtu-1de60.cloudfunctions.net/mpesaCallback';
      
      try{
        const { shortCode } = mpesaApi.configs;
        const testMSISDN = phoneNumber;
        console.log('Recipient: ',testMSISDN);
        console.log('Shortcode: ',shortCode);
        let result = await mpesaApi.b2c(shortCode, testMSISDN, amount, URL + '/b2c/timeout', URL + '/b2c/success')
        console.log('Mpesa Response...: ',result.status);      
      } catch(err){
        console.log('Tx error...: ',err); 
      }
  }    
  
    //CELOKIT FUNCTIONS
  async function getPublicAddress(mnemonic){
    console.log('Getting your account Public Address:....')
    let privateKey = await generatePrivKey(mnemonic);
    return new Promise(resolve => { 
        resolve (getAccAddress(getPublicKey(privateKey)));
      });
  }
  
  async function generatePrivKey(mnemonic){
      return bip39.mnemonicToSeedHex(mnemonic).substr(0, 64);
  }
  
  function getPublicKey(privateKey){
      let privToPubKey = hexToBuffer(privateKey);
      privToPubKey = privateToPublic(privToPubKey).toString('hex');
      privToPubKey = ensureLeading0x(privToPubKey);
      privToPubKey = toChecksumAddress(privToPubKey);
      return privToPubKey;
  }
  
  function getAccAddress(publicKey){
      let pubKeyToAddress = hexToBuffer(publicKey);
      pubKeyToAddress = pubToAddress(pubKeyToAddress).toString('hex');
      pubKeyToAddress = ensureLeading0x(pubKeyToAddress);
      pubKeyToAddress = toChecksumAddress(pubKeyToAddress)
      return pubKeyToAddress;   
  }
  
  async function sendcGold(sender, receiver, amount, privatekey){
      kit.addAccount(privatekey)
  
      let goldtoken = await kit.contracts.getGoldToken()
      let tx = await goldtoken.transfer(receiver, amount).send({from: sender})
      let receipt = await tx.waitReceipt()
      console.log('Transaction Details......................\n',prettyjson.render(receipt, options))
      console.log('Transaction ID:..... ', receipt.events.Transfer.transactionHash)
  
      let balance = await goldtoken.balanceOf(receiver)
      console.log('cGOLD Balance: ',balance.toString())
      return receipt.events.Transfer.transactionHash;
  }
  
  async function convertfromWei(value){
      return kit.web3.utils.fromWei(value.toString(), 'ether');
  }
  
  async function sendcUSD(sender, receiver, amount, privatekey){
      const weiTransferAmount = kit.web3.utils.toWei(amount.toString(), 'ether')
      const stableTokenWrapper = await kit.contracts.getStableToken()
  
      const senderBalance = await stableTokenWrapper.balanceOf(sender) // In cUSD
      if (amount > senderBalance) {        
          console.error(`Not enough funds in sender balance to fulfill request: ${await convertfromWei(amount)} > ${await convertfromWei(senderBalance)}`)
          return false
      }
      console.info(`sender balance of ${await convertfromWei(senderBalance)} cUSD is sufficient to fulfill ${await convertfromWei(weiTransferAmount)} cUSD`)
  
      kit.addAccount(privatekey)
      const stableTokenContract = await kit._web3Contracts.getStableToken()
      const txo = await stableTokenContract.methods.transfer(receiver, weiTransferAmount)
      const tx = await kit.sendTransactionObject(txo, { from: sender })
      console.info(`Sent tx object`)
      const hash = await tx.getHash()
      console.info(`Transferred ${amount} dollars to ${receiver}. Hash: ${hash}`)
      return hash
  }
  
  //working
  async function getBlock() {
    return kit.web3.eth.getBlock('latest');
  }


// TELEGRAM BOT API
app.post('/kotanibot', async (req, res) => {
    /*
      You can put the logic you want here
      the message receive will be in this
      https://core.telegram.org/bots/api#update
    */
    // const TelegramBot = require('node-telegram-bot-api');
    // const token = '1139179086:AAFYDu1IEbIehUyxLbAPRJxMVV6QJyIXUas';
    // // Created instance of TelegramBot
    // const bot = new TelegramBot(token, { polling: true });
    console.log(prettyjson.render(req.body));

    // const isTelegramMessage = req.body
    //                         && req.body.message
    //                         && req.body.message.chat
    //                         && req.body.message.chat.id
    //                         && req.body.message.from
    //                         && req.body.message.from.first_name

    const botPost = req.body
    console.log(JSON.stringify('Bot Data => ',botPost));
    const messagetext = `${botPost.message.text}`

    // console.log('Data: => ', isTelegramMessage);
  
    if (botPost.hasOwnProperty('message') && messagetext == '\/start') {            // && messagetext == "\/start"
      const chat_id = botPost.message.chat.id
      const { first_name } = req.body.message.from

      const reply = {
        method: 'sendMessage',
        chat_id,
        text: `Hello ${first_name} select option`,
        resize_keyboard: true,
        reply_markup: {"keyboard":[["Transfer Funds"],["Deposit Cash"],["Withdraw Cash"],["Pay Utilities"],["Loans and Savings"],["Paybill and Buy Goods"],["My Account"]]}
      };  
      return res.status(200).send(reply);
    }

    else if(botPost.hasOwnProperty('message') && messagetext == 'Transfer Funds'){
        console.log('Text: ',messagetext)
        const chat_id = req.body.message.chat.id
        const { first_name } = req.body.message.from
    
        return res.status(200).send({
          method: 'sendMessage',
          chat_id,
          text: `Enter your phone Number with country code:`,
          requestPhoneKeyboard: true
        })
    }

    else if(botPost.hasOwnProperty('message') && messagetext == 'Deposit Cash'){
        console.log('Text: ',messagetext)
        const chat_id = req.body.message.chat.id
        const { first_name } = req.body.message.from
    
        return res.status(200).send({
          method: 'sendMessage',
          chat_id,
          text: `Enter your phone Number with country code:`,
          resize_keyboard: true,
          reply_markup: {"keyboard":[["7","8","9"], 
          ["4" , "5","6"],
          ["1","2","3"], 
          ["0","+","SEND"]]}
        })
    }

    else{
        const chat_id = botPost.message.chat.id
        const { first_name } = req.body.message.from

        const reply = {
            method: 'sendMessage',
            chat_id,
            text: `Hello ${first_name} select option`,
            resize_keyboard: true,
            reply_markup: {"keyboard":[["Transfer Funds"],["Deposit Cash"],["Withdraw Cash"],["Pay Utilities"],["Loans and Savings"],["Paybill and Buy Goods"],["My Account"]]}
        };  
        return res.status(200).send(reply);
    }
  
    return res.status(200).send({ status: 'not a telegram message' })
  });




exports.kotanipay = functions.region('europe-west3').https.onRequest(app);       //.region('europe-west1')

exports.addUserData = functions.region('europe-west3').auth.user().onCreate((user) => {
    console.log('creating new user data:', user.uid, user.phoneNumber)
    addUserDataToDB(user.uid, user.phoneNumber.substring(1))
});

exports.mpesaCallback = functions.region('europe-west3').https.onRequest(mpesaApp);
