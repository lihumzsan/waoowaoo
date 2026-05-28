import { randomUUID } from 'node:crypto'
import { prisma } from './prisma'

export async function createTestUser() {
  const suffix = randomUUID().slice(0, 8)
  return await prisma.user.create({
    data: {
      name: `task_user_${suffix}`,
      email: `task_${suffix}@example.com`,
    },
  })
}

export async function createTestProject(userId: string) {
  const suffix = randomUUID().slice(0, 8)
  return await prisma.project.create({
    data: {
      name: `Task Project ${suffix}`,
      userId,
    },
  })
}
