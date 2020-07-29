//This is The USSD Post Request for End-to-end Celo Transfer
function ussdPostRequest(){ //Secured API Call from the Telco    
    const { sessionId, serviceCode, phoneNumber, text } = req.body;     //Data Received from the Telco MNO
    var data = text.split('*');

    //  TRANSFER && PHONENUMBER && AMOUNT
    senderMSISDN = phoneNumber.substring(1);    //Receives the phoneNumber as a 
    try {   //This validates that the recipients phoneNumber is in the correct format
        const recnumber = phoneUtil.parseAndKeepRawInput(`${data[1]}`, 'KE');   //Numbers in National Format are converted to Kenyan Numbers in E164 format
        receiverMSISDN = phoneUtil.format(recnumber, PNF.E164);
    } catch (error) {console.log(error);}

    receiverMSISDN = receiverMSISDN.substring(1);       
    amount = data[2];
    senderId = await getUserId(senderMSISDN);   //Returns a SHA1 hash of the user's PhoneNumber (USERID) 
    recipientId = await getUserId(receiverMSISDN);  

    // Check if users exists in API Database:
    let senderstatusresult = await checkIfSenderExists(senderId);       //Checks if a document with the USERID provided exists
    if(senderstatusresult == false){ await createNewUser(senderId, senderMSISDN) }    // If the document does not exist, the call the create new user function

    let recipientstatusresult = await checkIfRecipientExists(recipientId);
    if(recipientstatusresult == false){ await createNewUser(recipientId, receiverMSISDN) }  

    // Retrieve User Blockchain Data
    let senderInfo = await getSenderDetails(senderId);      //Retrieves the user Details from the firestore database
    let senderprivkey = await getSenderPrivateKey(senderInfo.data().seedKey, senderMSISDN, iv)      //Decrypts the mnemonic seed and obtains the privatekey using the seedkey
    let receiverInfo = await getReceiverDetails(recipientId);

    // Similar to DappKit Functions
    let hash = await transfercUSD(senderInfo.data().publicAddress, senderprivkey, receiverInfo.data().publicAddress, amount);
    let url = await getTxidUrl(hash);

    let message2sender = `KES ${amount}  sent to ${receiverMSISDN} Celo Account.\n Transaction URL:  ${url}`;
    let message2receiver = `You have received KES ${amount} from ${senderMSISDN} Celo Account. \n Transaction Link:  ${url}`;

    //Sends an SMS message with the details of the Transactions
    sendMessage("+"+senderMSISDN, message2sender);
    sendMessage("+"+receiverMSISDN, message2receiver);

    response = `END KES `+amount+` sent to `+receiverMSISDN+` Celo Account\n => Transaction Details: ${url}`; 
};


async function checkIfUserExists(userId){   //Checks if a document with the USERID provided exists 
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
        .catch( error => {console.log(error);} );
    });    
}  

function createNewUser(userId, userMSISDN){             //This was to optimize firebase queries since firestore returns the whole data set when you lookup a documentID
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

//This is triggered when createNewUser function executes successfully
exports.addUserData = functions.auth.user().onCreate((user) => {
    console.log('creating new user data:', user.uid, user.phoneNumber)
    addUserDataToDB(user.uid, user.phoneNumber.substring(1))
});

function getUserId(userMSISDN){       //generates a userID by hashing the phoneNumber using SHA1 encryption: how can we query this function from the contractKit for Uniformity across the Apps ecosystem
    return new Promise(resolve => {
      let userId = crypto.createHash(phone_hash_fn).update(userMSISDN).digest('hex');    
      resolve(userId);
    });
} 

async function addUserDataToDB(userId, userMSISDN){ 
    try {
      console.log('user ID: ', userId)
      let loginpin = await createcypher(await generateLoginPin(), userMSISDN, iv); 
      let mnemonic = await bip39.generateMnemonic(256);     //Generates a new BIP39 mnemonic seed
      var enc_seed = await createcypher(mnemonic, userMSISDN, iv);
      let publicAddress = await getPublicAddress(mnemonic);
  
      const newAccount = {
          'seedKey' : `${enc_seed}`,
          'publicAddress' : `${publicAddress}`,
          'userLoginPin' : loginpin
      };
  
      let db = firestore.collection('accounts').doc(userId);    //We intend to move this data to IPFS and store it in an encrypted bucket, only accessible by the user
      db.set(newAccount).then(newDoc => {console.log("Document Created:\n", newDoc.id)})
      // // signupDeposit(publicAddress);
    } catch (err) {
      console.log(err);
    }
    return true; 
}

async function createcypher(text, userMSISDN, iv){      //Encryption function when storing the user data into firestore
    const crypto = require('crypto');
    let key = await getEncryptKey(userMSISDN);
    const cipher = crypto.createCipher('aes192',  key, iv);    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted; 
}

async function decryptcypher(encrypted, userMSISDN, iv){        //Decryption function when retrieving the user data from firestore
    const crypto = require('crypto');
    let key = await getEncryptKey(userMSISDN);
    const decipher = crypto.createDecipher('aes192', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function generateLoginPin(){                //Generates a random 5char String which creates a 2FA when sending transactions.
    return new Promise(resolve => {         //In the next iteration, this can be supplied by the user during account creation
      resolve (randomstring.generate({ length: 5, charset: 'numeric' }));
    });
}

async function getSenderDetails(senderId){
    let db = firestore.collection('accounts').doc(senderId);
    let result = await db.get();
    return result;    
}
