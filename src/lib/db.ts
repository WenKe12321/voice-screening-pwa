import type { StoredSessionEnvelope, VaultMetadata } from '../domain/types'

const DB_NAME = 'voice-screening-vault'
const DB_VERSION = 1
const META_STORE = 'meta'
const SESSION_STORE = 'sessions'
const VAULT_META_KEY = 'vault'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode)
    const request = work(transaction.objectStore(name))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => reject(transaction.error)
  })
}

export function loadVaultMetadata(): Promise<VaultMetadata | undefined> {
  return withStore<VaultMetadata | undefined>(META_STORE, 'readonly', (store) => store.get(VAULT_META_KEY))
}

export function saveVaultMetadata(metadata: VaultMetadata): Promise<IDBValidKey> {
  return withStore<IDBValidKey>(META_STORE, 'readwrite', (store) => store.put(metadata, VAULT_META_KEY))
}

export function saveSession(envelope: StoredSessionEnvelope): Promise<IDBValidKey> {
  return withStore<IDBValidKey>(SESSION_STORE, 'readwrite', (store) => store.put(envelope))
}

export function listSessionEnvelopes(): Promise<StoredSessionEnvelope[]> {
  return withStore<StoredSessionEnvelope[]>(SESSION_STORE, 'readonly', (store) => store.getAll())
}

export function deleteSession(id: string): Promise<undefined> {
  return withStore<undefined>(SESSION_STORE, 'readwrite', (store) => store.delete(id))
}

export async function clearVault(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([META_STORE, SESSION_STORE], 'readwrite')
    transaction.objectStore(META_STORE).clear()
    transaction.objectStore(SESSION_STORE).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
}
