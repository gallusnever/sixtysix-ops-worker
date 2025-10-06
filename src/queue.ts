import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { generateProof } from './jobs/generateProof.js'
import { ProofJob } from './types.js'

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null
})

export const proofsQueue = new Queue<ProofJob>('proofs', { connection })

export function startWorker() {
  const worker = new Worker<ProofJob>('proofs', generateProof, {
    connection,
    concurrency: Number(process.env.PROOF_CONCURRENCY || '2')
  })
  worker.on('completed', (job) => console.log('Proof completed', job.id))
  worker.on('failed', (job, err) => console.error('Proof failed', job?.id, err))
}
