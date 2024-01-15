import * as fs from "fs";
import { SmartAccountSigner, WalletClientSigner } from "@alchemy/aa-core";
import { SignerData } from "@biconomy/modules/src";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { polygonMumbai } from "viem/chains";
import { ISessionStorage, SessionLeafNode, SessionSearchParam, SessionStatus } from "@biconomy/modules/src/interfaces/ISessionStorage";

export class SessionFileStorage implements ISessionStorage {
  private smartAccountAddress: string;

  constructor(smartAccountAddress: string) {
    this.smartAccountAddress = smartAccountAddress.toLowerCase();
  }

  // This method reads data from the file and returns it in the JSON format
  private async readDataFromFile(type: "sessions" | "signers"): Promise<any> {
    return new Promise((resolve) => {
      fs.readFile(this.getStorageFilePath(type), "utf8", (err, data) => {
        if (err) {
          // Handle errors appropriately
          resolve(undefined);
        } else {
          if (!data) {
            resolve(null);
          } else {
            resolve(JSON.parse(data));
          }
          //   resolve(JSON.parse(data));
        }
      });
    });
  }

  private getStorageFilePath(type: "sessions" | "signers"): string {
    return `./packages/account/tests/modules/utils/sessionStorageData/${this.smartAccountAddress}_${type}.json`;
  }

  private async writeDataToFile(data: any, type: "sessions" | "signers"): Promise<void> {
    return new Promise((resolve, reject) => {
      const filePath = this.getStorageFilePath(type);
      fs.writeFile(filePath, JSON.stringify(data), "utf8", (err) => {
        if (err) {
          // Handle errors appropriately
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private validateSearchParam(param: SessionSearchParam): void {
    if (param.sessionID) {
      return;
    } else if (!param.sessionID && param.sessionPublicKey && param.sessionValidationModule) {
      return;
    } else {
      throw new Error("Either pass sessionId or a combination of sessionPublicKey and sessionValidationModule address.");
    }
  }

  // Session store is in the form of mekrleRoot and leafnodes, each object will have a root and an array of leafNodes.
  private async getSessionStore(): Promise<any> {
    // eslint-disable-next-line no-useless-catch
    try {
      const data = await this.readDataFromFile("sessions");
      return data || { merkleRoot: "", leafNodes: [] };
    } catch (error) {
      // Handle errors appropriately
      throw error;
    }
  }

  private async getSignerStore(): Promise<any> {
    // eslint-disable-next-line no-useless-catch
    try {
      const data = await this.readDataFromFile("signers");
      return data || {};
    } catch (error) {
      // Handle errors appropriately
      throw error;
    }
  }

  private getStorageKey(type: "sessions" | "signers"): string {
    return `${this.smartAccountAddress}_${type}`;
  }

  private toLowercaseAddress(address: string): `0x${string}` {
    return `0x${address.toLowerCase()}`;
  }

  async getSessionData(): Promise<SessionLeafNode> {
    const sessions = (await this.getSessionStore()).leafNodes;
    console.log("Got sessions", sessions);
    const session = sessions[0];

    if (!session) {
      throw new Error("Session not found.");
    }
    return session;
  }

  async addSessionData(leaf: SessionLeafNode): Promise<void> {
    console.log("Add session Data", leaf);
    const data = await this.getSessionStore();
    leaf.sessionValidationModule = this.toLowercaseAddress(leaf.sessionValidationModule);
    leaf.sessionPublicKey = this.toLowercaseAddress(leaf.sessionPublicKey);
    data.leafNodes.push(leaf);
    await this.writeDataToFile(data, "sessions"); // Use 'sessions' as the type
  }

  async updateSessionStatus(param: SessionSearchParam, status: SessionStatus): Promise<void> {
    this.validateSearchParam(param);

    const data = await this.getSessionStore();
    const session = data.leafNodes.find((s: SessionLeafNode) => {
      if (param.sessionID) {
        return s.sessionID === param.sessionID;
      } else if (param.sessionPublicKey && param.sessionValidationModule) {
        return (
          s.sessionPublicKey === this.toLowercaseAddress(param.sessionPublicKey) &&
          s.sessionValidationModule === this.toLowercaseAddress(param.sessionValidationModule)
        );
      } else {
        return undefined;
      }
    });

    if (!session) {
      throw new Error("Session not found.");
    }

    session.status = status;
    await this.writeDataToFile(data, "sessions"); // Use 'sessions' as the type
  }

  async clearPendingSessions(): Promise<void> {
    const data = await this.getSessionStore();
    data.leafNodes = data.leafNodes.filter((s: SessionLeafNode) => s.status !== "PENDING");
    await this.writeDataToFile(data, "sessions"); // Use 'sessions' as the type
  }

  async addSigner(signerData: SignerData): Promise<WalletClientSigner> {
    const signers = await this.getSignerStore();
    let signer: SignerData;
    if (!signerData) {
      const pkey = generatePrivateKey();
      signer = {
        pvKey: pkey,
        pbKey: privateKeyToAccount(pkey).publicKey,
      };
    } else {
      signer = signerData;
    }
    const accountSigner = privateKeyToAccount(signer.pvKey);
    const client = createWalletClient({
      account: accountSigner,
      chain: signerData.chainId,
      transport: http(polygonMumbai.rpcUrls.public.http[0]),
    });
    const walletClientSigner: SmartAccountSigner = new WalletClientSigner(
      client,
      "json-rpc", // signerType
    );
    signers[this.toLowercaseAddress(accountSigner.address)] = {
      pvKey: signer.pvKey,
      pbKey: signer.pbKey,
    };
    await this.writeDataToFile(signers, "signers"); // Use 'signers' as the type
    return walletClientSigner;
  }

  async getSignerByKey(sessionPublicKey: string): Promise<WalletClientSigner> {
    const signers = await this.getSignerStore();
    console.log("Got signers", signers);

    const signerData: SignerData = signers[this.toLowercaseAddress(sessionPublicKey)];
    if (!signerData) {
      throw new Error("Signer not found.");
    }
    console.log(signerData.pvKey, "PVKEY");

    const signer = privateKeyToAccount(signerData.pvKey);
    const walletClient = createWalletClient({
      account: signer,
      transport: http(polygonMumbai.rpcUrls.public.http[0]),
    });
    return new WalletClientSigner(walletClient, "json-rpc");
  }

  async getSignerBySession(): Promise<WalletClientSigner> {
    const session = await this.getSessionData();
    console.log("got session", session);
    const walletClientSinger = await this.getSignerByKey(session.sessionPublicKey);
    return walletClientSinger;
  }

  async getAllSessionData(param?: SessionSearchParam): Promise<SessionLeafNode[]> {
    const sessions = (await this.getSessionStore()).leafNodes;
    if (!param || !param.status) {
      return sessions;
    }
    return sessions.filter((s: SessionLeafNode) => s.status === param.status);
  }

  async getMerkleRoot(): Promise<string> {
    return (await this.getSessionStore()).merkleRoot;
  }

  async setMerkleRoot(merkleRoot: string): Promise<void> {
    const data = await this.getSessionStore();
    data.merkleRoot = merkleRoot;
    await this.writeDataToFile(data, "sessions"); // Use 'sessions' as the type
  }
}