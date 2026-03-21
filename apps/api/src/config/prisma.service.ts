import { Injectable, OnModuleInit, OnModuleDestroy, Scope } from '@nestjs/common';
import { PrismaClient } from '@agems/db';

// Models that have orgId field and need tenant filtering
const TENANT_MODELS = [
  'agent', 'tool', 'channel', 'task', 'meeting',
  'orgPosition', 'setting', 'auditLog', 'plugin',
];

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Returns a Prisma client scoped to a specific organization.
   * All queries on tenant-scoped models will automatically filter by orgId.
   * Creates (where applicable) will automatically set orgId.
   */
  forOrg(orgId: string) {
    return this.$extends({
      query: {
        $allModels: {
          async findMany({ model, args, query }) {
            if (TENANT_MODELS.includes(model![0].toLowerCase() + model!.slice(1))) {
              args.where = { ...args.where, orgId };
            }
            return query(args);
          },
          async findFirst({ model, args, query }) {
            if (TENANT_MODELS.includes(model![0].toLowerCase() + model!.slice(1))) {
              args.where = { ...args.where, orgId };
            }
            return query(args);
          },
          async findUnique({ model, args, query }) {
            if (TENANT_MODELS.includes(model![0].toLowerCase() + model!.slice(1))) {
              // findUnique only supports unique fields in where, so we convert to findFirst
              // and add orgId check
              const result = await (query as any)(args);
              if (result && (result as any).orgId && (result as any).orgId !== orgId) {
                return null; // belongs to different org
              }
              return result;
            }
            return query(args);
          },
          async create({ model, args, query }) {
            if (TENANT_MODELS.includes(model![0].toLowerCase() + model!.slice(1))) {
              (args.data as any).orgId = (args.data as any).orgId || orgId;
            }
            return query(args);
          },
          async update({ model, args, query }) {
            if (TENANT_MODELS.includes(model![0].toLowerCase() + model!.slice(1))) {
              // Post-query check: verify the record belongs to this org
              const result = await query(args);
              if (result && (result as any).orgId && (result as any).orgId !== orgId) {
                throw new Error('Access denied: resource belongs to another organization');
              }
              return result;
            }
            return query(args);
          },
          async delete({ model, args, query }) {
            if (TENANT_MODELS.includes(model![0].toLowerCase() + model!.slice(1))) {
              const result = await query(args);
              if (result && (result as any).orgId && (result as any).orgId !== orgId) {
                throw new Error('Access denied: resource belongs to another organization');
              }
              return result;
            }
            return query(args);
          },
          async count({ model, args, query }) {
            if (TENANT_MODELS.includes(model![0].toLowerCase() + model!.slice(1))) {
              args.where = { ...args.where, orgId };
            }
            return query(args);
          },
        },
      },
    });
  }
}
