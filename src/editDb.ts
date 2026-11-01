import type { GameWindow } from './types'
import type { RallyClip } from './clips'
import type { ActionProposal } from './proposals'

const DB_NAME = 'volley-scout-edit'
const STORE = 'projects'

export type EditProject = {
  videoName: string
  gameWindow: GameWindow
  clips: RallyClip[]
  proposals: ActionProposal[]
  updatedAt: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'videoName' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the local edit database'))
  })
}

export async function loadEditProject(videoName: string): Promise<EditProject | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(videoName)
      request.onsuccess = () => resolve((request.result as EditProject | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Could not read the local edit'))
    })
  } finally {
    db.close()
  }
}

export async function saveEditProject(project: EditProject): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(project)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Could not save the local edit'))
    })
  } finally {
    db.close()
  }
}
