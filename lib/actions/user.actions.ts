"use server";

import { createAdminClient, createSessionClient } from "@/lib/appwrite";
import { cookies } from "next/headers";
import { ID, Query } from "node-appwrite";
import { encryptId, extractCustomerIdFromUrl, parseStringify } from "../utils";
import { CountryCode, ProcessorTokenCreateRequest, ProcessorTokenCreateRequestProcessorEnum, Products } from "plaid";
import { plaidClient } from "../plaid";
import { addFundingSource, createDwollaCustomer } from "./dwolla.actions";
import { revalidatePath } from "next/cache";

const { 
  APPWRITE_DATABASE_ID: DATABASE_ID,
  APPWRITE_USER_COLLECTION_ID: USER_COLLECTION_ID,
  APPWRITE_BANK_COLLECTION_ID: BANK_COLLECTION_ID,
 } = process.env;

export const getUserInfo = async ({userId}: {userId: string}) => {
  try {
    const { database } = await createAdminClient();
    const user = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [Query.equal("userId", [userId])]
    );
    return parseStringify(user.documents[0]);
  } catch (error) {
    console.log("Error: ", error);
  }
}

export const signIn = async ({email, password}: signInProps) => {
  try {
    const { account } = await createAdminClient();
    const session = await account.createEmailPasswordSession(email, password);

    cookies().set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    const user = await getUserInfo({userId: session.userId});
    return parseStringify(user);
  } catch (error) {
    console.log("Error: ", error);
  }
};

export const signUp = async ({password, ...userData}: SignUpParams) => {
  const { email, firstName, lastName } = userData;
  let newUserAccount;

  try {
    const { account, database } = await createAdminClient();

    newUserAccount = await account.create(
      ID.unique(),
      email,
      password,
      `${firstName} ${lastName}`
    );

    if(!newUserAccount) {
      throw new Error("Error occurred while creating user account");
    }

    const dwollaCustomerUrl = await createDwollaCustomer({
      ...userData,
      type: 'personal'
    });

    if(!dwollaCustomerUrl) {
      throw new Error("Error occurred while creating Dwolla customer");
    }

    const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl);

    const newUser = await database.createDocument(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      ID.unique(),
      {
        ...userData,
        dwollaCustomerUrl,
        dwollaCustomerId,
        userId: newUserAccount.$id,
      }
    );

    const session = await account.createEmailPasswordSession(email, password);

    cookies().set("appwrite-session", session.secret, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    return parseStringify(newUser);
  } catch (error) {
    console.log("Error: ", error);
  }
};

// ... your initilization functions

export async function getLoggedInUser() {
  try {
    const { account } = await createSessionClient();
    const result = await account.get();

    const user = await getUserInfo({userId: result.$id});

    return parseStringify(user);
  } catch (error) {
    return null;
  }
}

export async function logoutAccount() {
  try { 
    const { account } = await createSessionClient();

    cookies().delete("appwrite-session");
    await account.deleteSession("current");
  } catch(error) {
    return null;
  }
}

export const createLinkToken = async (user: User) => {
  try {
    const tokenParams = {
      user: {
        client_user_id: user.$id,
      },
      client_name: `${user.firstName} ${user.lastName}`,
      products:  ["auth"] as Products[],
      language: "en",
      country_codes: ["US"] as CountryCode[],
    }

    const response = await plaidClient.linkTokenCreate(tokenParams);
    return parseStringify({linkToken: response.data.link_token});
  } catch (error) {
    console.log("Error: ", error);
  }
}


export const exchangePublicToken = async ({publicToken, user}: exchangePublicTokenProps) => {

  // 3 way handshake to exchange public token for access token
  // first generate token and send to plaid, plaids sends back public token and then we exchange it for access token
  try {
   const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
   });
   const accessToken = response.data.access_token;
   const itemId = response.data.item_id;

   // get account information using access token
   const accountResponse = await plaidClient.accountsGet({
    access_token: accessToken,
   }); 
   const accountData = accountResponse.data.accounts[0];

   // create a request token for Dwolla using access token and account id
   const request: ProcessorTokenCreateRequest = {
    access_token: accessToken,
    account_id: accountData.account_id,
    processor: "dwolla" as ProcessorTokenCreateRequestProcessorEnum,
   }

   // create a processor token 
   const processorTokenResponse = await plaidClient.processorTokenCreate(request);
   const processorToken = processorTokenResponse.data.processor_token;

   // create a funding source URL for the account using Dwolla customer ID, processor token and bank name
   const fundingSourceUrl = await addFundingSource({
    dwollaCustomerId: user.dwollaCustomerId, 
    processorToken,
    bankName: accountData.name,
   });

   if(!fundingSourceUrl) {
    throw new Error("Error occurred while adding funding source");
   }

   // create the bank account using the user id, item id, account id, access token, funding source URL and sharable id
   await createBankAccount({
    userId: user.$id,
    bankId: itemId,
    accountId: accountData.account_id,
    accessToken,
    fundingSourceUrl,
    sharableId: encryptId(accountData.account_id),
   });

   // revalidate the path to reflect changes
   revalidatePath("/");

   // return success message
   return parseStringify({publicTokenExchange: "complete"});
  } catch (error) {
    console.log("Error occurred while exchanging token: ", error);
  }
}

export const createBankAccount = async ({userId, bankId, accountId, accessToken, fundingSourceUrl, sharableId}: createBankAccountProps) => {
  try {
    const { database } = await createAdminClient();
    const bankAccount = await database.createDocument(
      DATABASE_ID!, 
      BANK_COLLECTION_ID!, 
      ID.unique(), 
      {
        userId,
        bankId,
        accountId,
        accessToken,
        fundingSourceUrl,
        sharableId,
      }
    );
    return parseStringify(bankAccount);
  } catch (error) {
    console.log("Error: ", error);
  }
}

export const getBanks = async ({userId}: getBanksProps) => {
  try {
    const { database } = await createAdminClient();
    const banks = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal('userId', [userId])]
    );
    // banks.documents = banks.documents.filter((bank: any) => bank.userId.userId === userId);
    return parseStringify(banks.documents);
  } catch (error) {
    console.log("Error: ", error);
  }
}

export const getBank = async ({documentId}: getBankProps) => {
  try {
    const { database } = await createAdminClient();
    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal('$id', [documentId])]
    );
    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.log("Error: ", error);
  }
}

export const getBankByAccountId = async ({accountId}: getBankByAccountIdProps) => {
  try {
    const { database } = await createAdminClient();
    const bank = await database.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal('accountId', [accountId])]
    );
    if(bank.total !== 1) return null;
    return parseStringify(bank.documents[0]);
  } catch (error) {
    console.log("Error: ", error);
  }
}