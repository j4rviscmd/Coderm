/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IUpdate } from '../common/update.js';

/**
 * Represents a single downloadable asset within a GitHub Release.
 */
interface IGitHubReleaseAsset {
	readonly name: string;
	readonly browser_download_url: string;
	readonly size: number;
}

/**
 * Represents a GitHub Release as returned by the GitHub Releases API.
 */
interface IGitHubRelease {
	readonly tag_name: string;
	readonly target_commitish: string;
	readonly assets: IGitHubReleaseAsset[];
	readonly published_at: string;
}

/**
 * Fetches the latest release from the GitHub Releases API.
 *
 * Derives the API endpoint from the product's `updateUrl` by converting
 * a repository URL (e.g. `https://github.com/owner/repo`) into the
 * corresponding GitHub REST API endpoint for the latest release.
 *
 * @param requestService - The request service used to make HTTP requests.
 * @param productService - The product service providing the `updateUrl` configuration.
 * @param logService - The log service for trace/error logging.
 * @param token - A cancellation token to abort the request.
 * @returns The latest {@link IGitHubRelease} if found, or `undefined` on failure.
 */
async function fetchLatestRelease(
	requestService: IRequestService,
	productService: IProductService,
	logService: ILogService,
	token: CancellationToken
): Promise<IGitHubRelease | undefined> {
	// Derive the GitHub API URL from the product's updateUrl
	// updateUrl is "https://github.com/j4rviscmd/Coderm"
	// API URL is "https://api.github.com/repos/j4rviscmd/Coderm/releases/latest"
	const updateUrl = productService.updateUrl;
	if (!updateUrl) {
		return undefined;
	}

	const repoPath = updateUrl.replace('https://github.com/', '');
	const apiUrl = `https://api.github.com/repos/${repoPath}/releases/latest`;

	logService.trace('coderm-update#fetchLatestRelease - fetching', apiUrl);

	try {
		const context = await requestService.request({
			url: apiUrl,
			headers: {
				'Accept': 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'Coderm-Update-Check'
			},
			callSite: 'codermUpdateService.fetchLatestRelease'
		}, token);

		const release = await asJson<IGitHubRelease>(context);
		if (!release || !release.tag_name) {
			logService.trace('coderm-update#fetchLatestRelease - no release found');
			return undefined;
		}

		return release;
	} catch (err) {
		logService.error('coderm-update#fetchLatestRelease - failed', err);
		return undefined;
	}
}

/**
 * Finds the appropriate downloadable asset for the current platform and architecture.
 *
 * Asset naming convention:
 *   - macOS arm64: `*.dmg` containing `"arm64"`
 *   - macOS x64:   `*.dmg` without `"arm64"`
 *   - Windows x64: `*.exe`
 *
 * @param release - The GitHub release whose assets are searched.
 * @param platform - The OS platform (`'darwin'` or `'win32'`).
 * @param arch - The CPU architecture (e.g. `'arm64'`, `'x64'`).
 * @returns The matching {@link IGitHubReleaseAsset}, or `undefined` if none found.
 */
function findAssetForPlatform(release: IGitHubRelease, platform: 'darwin' | 'win32', arch: string): IGitHubReleaseAsset | undefined {
	return release.assets.find(asset => {
		const name = asset.name.toLowerCase();
		if (platform === 'darwin') {
			if (!name.endsWith('.dmg')) {
				return false;
			}
			if (arch === 'arm64') {
				return name.includes('arm64');
			}
			// x64 DMG should not contain 'arm64'
			return !name.includes('arm64');
		}
		if (platform === 'win32') {
			return name.endsWith('.exe');
		}
		return false;
	});
}

/**
 * Converts a GitHub Release and its matching asset into the VSCode {@link IUpdate} format.
 *
 * Strips the leading `'v'` from the tag name to derive the `productVersion`.
 *
 * @param release - The GitHub release to convert.
 * @param asset - The platform-specific asset to use for the download URL.
 * @returns An {@link IUpdate} object populated with version, URL, and timestamp.
 */
function releaseToIUpdate(release: IGitHubRelease, asset: IGitHubReleaseAsset): IUpdate {
	const productVersion = release.tag_name.replace(/^v/, '');

	return {
		version: release.tag_name,
		productVersion,
		url: asset.browser_download_url,
		timestamp: new Date(release.published_at).getTime()
	};
}

/**
 * Checks if a GitHub release is newer than the current installed version.
 *
 * Compares the upstream semver segments (major.minor.patch) first.
 * If those are equal, compares the Coderm-specific segments after the
 * `-coderm` prerelease suffix.
 *
 * Version format: `{upstream_version}[-coderm.{segments...}]`
 *
 * @example
 * ```ts
 * // Comparing coderm segments: 0.9 < 0.10 (numeric comparison, not lexicographic)
 * isNewerRelease("1.121.0-coderm.0.9", { tag_name: "v1.121.0-coderm.0.10" }) // true
 * ```
 *
 * @param currentVersion - The current product version string, or `undefined` to
 *   always consider the release newer.
 * @param release - The candidate GitHub release.
 * @returns `true` if the release version is strictly greater than the current version.
 */
function isNewerRelease(currentVersion: string | undefined, release: IGitHubRelease): boolean {
	if (!currentVersion) {
		return true;
	}

	const releaseVersion = release.tag_name.replace(/^v/, '');

	// Parses a version string into upstream (major.minor.patch) and optional
	// Coderm prerelease segments. The regex captures groups 1-3 as upstream
	// semver and group 4 as the dot-separated coderm suffix (e.g. "0.10").
	const parseVersion = (v: string) => {
		const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-coderm\.((?:\d+\.)*\d+))?/);
		if (!match) {
			return { upstream: [0, 0, 0], coderm: [] as number[] };
		}
		const upstream = [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
		const coderm = match[4] ? match[4].split('.').map(s => parseInt(s, 10)) : [];
		return { upstream, coderm };
	};

	const current = parseVersion(currentVersion);
	const next = parseVersion(releaseVersion);

	for (let i = 0; i < 3; i++) {
		if (next.upstream[i] !== current.upstream[i]) {
			return next.upstream[i] > current.upstream[i];
		}
	}

	const maxLen = Math.max(current.coderm.length, next.coderm.length);
	for (let i = 0; i < maxLen; i++) {
		const cVal = current.coderm[i] ?? 0;
		const nVal = next.coderm[i] ?? 0;
		if (nVal !== cVal) {
			return nVal > cVal;
		}
	}

	return false;
}

/**
 * Main entry point for Coderm's GitHub Releases-based update check.
 *
 * Fetches the latest release from the configured GitHub repository,
 * selects the appropriate platform asset, and compares versions.
 * Returns an {@link IUpdate} object when a newer version is available,
 * or `undefined` when the application is already up-to-date.
 *
 * @param requestService - The request service used for HTTP requests.
 * @param productService - The product service providing version and update URL.
 * @param logService - The log service for diagnostic output.
 * @param platform - The OS platform (`'darwin'` or `'win32'`).
 * @param arch - The CPU architecture (e.g. `'arm64'`, `'x64'`).
 * @param token - A cancellation token to abort the operation.
 * @returns An {@link IUpdate} if a newer version is available, otherwise `undefined`.
 */
export async function checkForGitHubReleaseUpdate(
	requestService: IRequestService,
	productService: IProductService,
	logService: ILogService,
	platform: 'darwin' | 'win32',
	arch: string,
	token: CancellationToken
): Promise<IUpdate | undefined> {
	const release = await fetchLatestRelease(requestService, productService, logService, token);
	if (!release) {
		return undefined;
	}

	const asset = findAssetForPlatform(release, platform, arch);
	if (!asset) {
		logService.trace('coderm-update#checkForGitHubReleaseUpdate - no matching asset found', { platform, arch, assets: release.assets.map(a => a.name) });
		return undefined;
	}

	if (!isNewerRelease(productService.version, release)) {
		logService.trace('coderm-update#checkForGitHubReleaseUpdate - already up to date', { current: productService.version, latest: release.tag_name });
		return undefined;
	}

	return releaseToIUpdate(release, asset);
}
