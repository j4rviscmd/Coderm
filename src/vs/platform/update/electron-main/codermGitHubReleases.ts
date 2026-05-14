/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IUpdate } from '../common/update.js';

interface IGitHubReleaseAsset {
	readonly name: string;
	readonly browser_download_url: string;
	readonly size: number;
}

interface IGitHubRelease {
	readonly tag_name: string;
	readonly target_commitish: string;
	readonly assets: IGitHubReleaseAsset[];
	readonly published_at: string;
}

/**
 * Fetches the latest release from the GitHub Releases API.
 * Returns undefined if the request fails or no release is found.
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
 * Finds the appropriate asset for the current platform and architecture.
 * Asset naming convention:
 *   macOS arm64: *.dmg containing "arm64"
 *   macOS x64:   *.dmg (no "arm64")
 *   Windows x64: *.exe
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
 * Converts a GitHub Release to the VSCode IUpdate format.
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
 * Checks if a GitHub release is newer than the current version.
 * Compares semver product versions.
 */
function isNewerRelease(currentVersion: string | undefined, release: IGitHubRelease): boolean {
	if (!currentVersion) {
		return true;
	}

	const releaseVersion = release.tag_name.replace(/^v/, '');

	// Parse semver
	const parseSemver = (v: string) => {
		const parts = v.split('.').map(p => parseInt(p, 10));
		return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
	};

	const current = parseSemver(currentVersion);
	const next = parseSemver(releaseVersion);

	if (next.major !== current.major) {
		return next.major > current.major;
	}
	if (next.minor !== current.minor) {
		return next.minor > current.minor;
	}
	return next.patch > current.patch;
}

/**
 * Main entry point: fetches the latest GitHub release and returns an IUpdate
 * if a newer version is available, or undefined if up-to-date.
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
