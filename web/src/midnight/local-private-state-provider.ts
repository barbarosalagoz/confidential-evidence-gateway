/**
 * A browser PrivateStateProvider backed by localStorage.
 *
 * This is the "local private state" of the DApp: evidence records (digest,
 * salt, and optionally the content itself) live only in this browser profile,
 * scoped per contract address. Nothing here is ever transmitted — the witness
 * implementations read from this store at proving time and their outputs go
 * only into the private transcript.
 *
 * Interface-compatible with @midnight-ntwrk/midnight-js-types 4.1.1
 * PrivateStateProvider (modeled on the official example-bboard in-memory
 * provider, persisted instead of ephemeral).
 */
import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type {
  ExportPrivateStatesOptions,
  ExportSigningKeysOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  PrivateStateId,
  PrivateStateProvider,
  SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';

const STATE_PREFIX = 'evidence-gateway/private-state';
const KEYS_PREFIX = 'evidence-gateway/signing-keys';

const encode = <T>(value: T): string => JSON.stringify(value);
const decode = <T>(value: string): T => JSON.parse(value) as T;

export const localStoragePrivateStateProvider = <PSI extends PrivateStateId, PS = unknown>(): PrivateStateProvider<
  PSI,
  PS
> => {
  let contractAddress: ContractAddress | null = null;

  const requireContractAddress = (): ContractAddress => {
    if (contractAddress === null) {
      throw new Error('Contract address not set. Call setContractAddress() before accessing private state.');
    }
    return contractAddress;
  };

  const stateKey = (address: ContractAddress, id: PSI): string => `${STATE_PREFIX}/${address}/${id}`;
  const stateIndexKey = (address: ContractAddress): string => `${STATE_PREFIX}/${address}/__index`;
  const signingKeyKey = (address: ContractAddress): string => `${KEYS_PREFIX}/${address}`;

  const readIndex = (address: ContractAddress): PSI[] => {
    const raw = localStorage.getItem(stateIndexKey(address));
    return raw ? decode<PSI[]>(raw) : [];
  };
  const writeIndex = (address: ContractAddress, ids: PSI[]): void => {
    localStorage.setItem(stateIndexKey(address), encode(ids));
  };

  return {
    setContractAddress(address: ContractAddress): void {
      contractAddress = address;
    },
    set(privateStateId: PSI, state: PS): Promise<void> {
      const address = requireContractAddress();
      localStorage.setItem(stateKey(address, privateStateId), encode(state));
      const index = readIndex(address);
      if (!index.includes(privateStateId)) writeIndex(address, [...index, privateStateId]);
      return Promise.resolve();
    },
    get(privateStateId: PSI): Promise<PS | null> {
      const raw = localStorage.getItem(stateKey(requireContractAddress(), privateStateId));
      return Promise.resolve(raw === null ? null : decode<PS>(raw));
    },
    remove(privateStateId: PSI): Promise<void> {
      const address = requireContractAddress();
      localStorage.removeItem(stateKey(address, privateStateId));
      writeIndex(
        address,
        readIndex(address).filter((id) => id !== privateStateId),
      );
      return Promise.resolve();
    },
    clear(): Promise<void> {
      const address = requireContractAddress();
      for (const id of readIndex(address)) localStorage.removeItem(stateKey(address, id));
      localStorage.removeItem(stateIndexKey(address));
      return Promise.resolve();
    },
    setSigningKey(address: ContractAddress, signingKey: SigningKey): Promise<void> {
      localStorage.setItem(signingKeyKey(address), encode(signingKey));
      return Promise.resolve();
    },
    getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      const raw = localStorage.getItem(signingKeyKey(address));
      return Promise.resolve(raw === null ? null : decode<SigningKey>(raw));
    },
    removeSigningKey(address: ContractAddress): Promise<void> {
      localStorage.removeItem(signingKeyKey(address));
      return Promise.resolve();
    },
    clearSigningKeys(): Promise<void> {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(KEYS_PREFIX)) doomed.push(key);
      }
      doomed.forEach((key) => localStorage.removeItem(key));
      return Promise.resolve();
    },
    exportPrivateStates(options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      void options;
      const address = requireContractAddress();
      const states = Object.fromEntries(
        readIndex(address).map((id) => [id, localStorage.getItem(stateKey(address, id)) ?? 'null']),
      );
      return Promise.resolve({
        format: 'midnight-private-state-export',
        encryptedPayload: encode({ contractAddress: address, states }),
        salt: 'local-storage-private-state-provider',
      });
    },
    importPrivateStates(
      exportData: PrivateStateExport,
      options?: ImportPrivateStatesOptions,
    ): Promise<ImportPrivateStatesResult> {
      const address = requireContractAddress();
      const conflictStrategy = options?.conflictStrategy ?? 'error';
      const payload = decode<{ states?: Record<string, string> }>(exportData.encryptedPayload);
      const states = payload.states ?? {};
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;
      for (const [rawId, serialized] of Object.entries(states)) {
        const id = rawId as PSI;
        const exists = localStorage.getItem(stateKey(address, id)) !== null;
        if (exists) {
          if (conflictStrategy === 'skip') {
            skipped += 1;
            continue;
          }
          if (conflictStrategy === 'error') {
            return Promise.reject(new Error(`Private state conflict for '${id}'`));
          }
          overwritten += 1;
        } else {
          imported += 1;
        }
        localStorage.setItem(stateKey(address, id), serialized);
        const index = readIndex(address);
        if (!index.includes(id)) writeIndex(address, [...index, id]);
      }
      return Promise.resolve({ imported, skipped, overwritten });
    },
    exportSigningKeys(options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      void options;
      const keys: Record<string, SigningKey> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(`${KEYS_PREFIX}/`)) {
          keys[key.slice(KEYS_PREFIX.length + 1)] = decode<SigningKey>(localStorage.getItem(key)!);
        }
      }
      return Promise.resolve({
        format: 'midnight-signing-key-export',
        encryptedPayload: encode({ keys }),
        salt: 'local-storage-signing-key-provider',
      });
    },
    importSigningKeys(
      exportData: SigningKeyExport,
      options?: ImportSigningKeysOptions,
    ): Promise<ImportSigningKeysResult> {
      const conflictStrategy = options?.conflictStrategy ?? 'error';
      const payload = decode<{ keys?: Record<string, SigningKey> }>(exportData.encryptedPayload);
      const keys = payload.keys ?? {};
      let imported = 0;
      let skipped = 0;
      let overwritten = 0;
      for (const [address, signingKey] of Object.entries(keys)) {
        const exists = localStorage.getItem(signingKeyKey(address)) !== null;
        if (exists) {
          if (conflictStrategy === 'skip') {
            skipped += 1;
            continue;
          }
          if (conflictStrategy === 'error') {
            return Promise.reject(new Error(`Signing key conflict for '${address}'`));
          }
          overwritten += 1;
        } else {
          imported += 1;
        }
        localStorage.setItem(signingKeyKey(address), encode(signingKey));
      }
      return Promise.resolve({ imported, skipped, overwritten });
    },
  };
};
