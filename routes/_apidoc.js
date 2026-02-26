/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
*/

// ========================================================
// Historical apidoc blocks should be inserted bellow.
// It will be used to generate the API documentation for the previous versions of the API.
// Please group the documentation blocks by the @apiGroup, then by @apiName for easier maintenance.
// ========================================================

// upgrades
// --------

/**
 * @apiVersion 17.0.0
 * @api {get} /upgrades/getPossibleUpgrades Get possible upgrades
 * @apiName GetPossibleUpgrades
 * @apiGroup upgrades
 * @apiDescription Get possible upgrades for a given source version.
 *
 * @apiQuery {string} sourceVersion The source version to get possible upgrades for.
 * @apiExample {string} Example request
 * /upgrades/getPossibleUpgrades?sourceVersion=3.2.0
 * @apiSuccess {string[]} versions List of possible upgrades.
 * @apiSuccessExample Example data on success
 * ["3.2.0-15", "3.2.1-16"]
 */
