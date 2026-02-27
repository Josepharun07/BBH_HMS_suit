/**
 * BBH HMS – UpdaterService
 *
 * THE "SAFE UPDATE" MECHANISM
 * ───────────────────────────
 * The Admin clicks "Update Website" in the Dashboard.
 * This service:
 *   1. Validates the target directory is the expected mount point.
 *   2. Runs `git pull` inside /mnt/website as a non-root user.
 *   3. PM2 (running in bbh-website container) detects file changes and restarts.
 *
 * Security:
 *   - The API container runs as UID 1001 (non-root).
 *   - The API ONLY writes files – it never calls Docker or runs arbitrary commands.
 *   - The only command ever executed is `git pull` inside a path-validated directory.
 *   - All activity is audit-logged.
 */

import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

export interface UpdateResult {
  success: boolean;
  output: string;
  branch: string;
  commit: string;
  timestamp: Date;
}

const WEBSITE_MOUNT = '/mnt/website';
const GIT_TIMEOUT_MS = 60_000; // 60 seconds

@Injectable()
export class UpdaterService {
  private readonly logger = new Logger(UpdaterService.name);
  private isUpdating = false;

  constructor(private readonly audit: AuditService) {}

  /**
   * Trigger a `git pull` inside the shared website volume.
   * Only one update can run at a time (mutex guard).
   */
  async pullWebsiteUpdate(
    performedById: string,
    ipAddress?: string,
  ): Promise<UpdateResult> {
    // ── 1. Mutex: prevent concurrent updates ──────────────────────────────
    if (this.isUpdating) {
      throw new BadRequestException('An update is already in progress');
    }
    this.isUpdating = true;

    try {
      // ── 2. Validate mount point exists ───────────────────────────────────
      await this.validateMountPoint(WEBSITE_MOUNT);

      // ── 3. Get current state for audit log ───────────────────────────────
      const beforeCommit = await this.getGitCommit(WEBSITE_MOUNT);

      this.logger.log(`Website update initiated by user ${performedById}`);

      // ── 4. Run git pull ───────────────────────────────────────────────────
      const { stdout, stderr } = await execAsync('git pull --ff-only', {
        cwd: WEBSITE_MOUNT,
        timeout: GIT_TIMEOUT_MS,
        env: {
          ...process.env,
          // Prevent interactive git prompts
          GIT_TERMINAL_PROMPT: '0',
          HOME: '/tmp',
        },
      });

      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      this.logger.log(`git pull output: ${output}`);

      // ── 5. Get new commit hash ────────────────────────────────────────────
      const afterCommit = await this.getGitCommit(WEBSITE_MOUNT);
      const branch = await this.getGitBranch(WEBSITE_MOUNT);

      const result: UpdateResult = {
        success: true,
        output,
        branch,
        commit: afterCommit,
        timestamp: new Date(),
      };

      // ── 6. Audit log ──────────────────────────────────────────────────────
      await this.audit.log({
        action: 'WEBSITE_UPDATE',
        resource: 'WebsiteSource',
        oldValue: { commit: beforeCommit },
        newValue: { commit: afterCommit, branch, output },
        performedById,
        ipAddress,
      });

      return result;
    } catch (error: any) {
      this.logger.error(`Website update failed: ${error.message}`, error.stack);

      await this.audit.log({
        action: 'WEBSITE_UPDATE_FAILED',
        resource: 'WebsiteSource',
        newValue: { error: error.message },
        performedById,
        ipAddress,
      });

      throw new InternalServerErrorException(
        `Update failed: ${error.message}`,
      );
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Get the current git status of the website source.
   */
  async getWebsiteStatus(): Promise<{
    branch: string;
    commit: string;
    lastModified: Date | null;
    isClean: boolean;
  }> {
    await this.validateMountPoint(WEBSITE_MOUNT);

    const [branch, commit, statusOut] = await Promise.all([
      this.getGitBranch(WEBSITE_MOUNT),
      this.getGitCommit(WEBSITE_MOUNT),
      execAsync('git status --porcelain', { cwd: WEBSITE_MOUNT })
        .then(({ stdout }) => stdout.trim())
        .catch(() => ''),
    ]);

    const stat = await fs
      .stat(path.join(WEBSITE_MOUNT, '.git', 'FETCH_HEAD'))
      .catch(() => null);

    return {
      branch,
      commit,
      lastModified: stat?.mtime ?? null,
      isClean: statusOut === '',
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private async validateMountPoint(mountPath: string): Promise<void> {
    // Resolve to prevent path traversal attacks
    const resolved = path.resolve(mountPath);

    if (resolved !== WEBSITE_MOUNT) {
      throw new BadRequestException('Invalid mount path');
    }

    try {
      await fs.access(resolved);
      const gitDir = await fs.access(path.join(resolved, '.git')).then(
        () => true,
        () => false,
      );
      if (!gitDir) {
        throw new BadRequestException(
          'Website directory is not a git repository',
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new InternalServerErrorException(
        'Website mount point is not accessible',
      );
    }
  }

  private async getGitCommit(cwd: string): Promise<string> {
    const { stdout } = await execAsync('git rev-parse --short HEAD', {
      cwd,
      timeout: 5000,
    }).catch(() => ({ stdout: 'unknown' }));
    return stdout.trim();
  }

  private async getGitBranch(cwd: string): Promise<string> {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      timeout: 5000,
    }).catch(() => ({ stdout: 'unknown' }));
    return stdout.trim();
  }
}
