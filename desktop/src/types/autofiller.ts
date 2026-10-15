/**
 * Shared renderer-side contract types for AutoFiller.
 *
 * Single source of truth: re-exports canonical wire contracts and IPC types
 * from Electron shared types to eliminate code duplication and prevent drift.
 */

export * from '../../electron/shared/types';
