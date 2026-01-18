/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chatRoomsInternal from "../chatRoomsInternal.js";
import type * as http from "../http.js";
import type * as messagesInternal from "../messagesInternal.js";
import type * as mutations from "../mutations.js";
import type * as queries from "../queries.js";
import type * as sessionsInternal from "../sessionsInternal.js";
import type * as usersInternal from "../usersInternal.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chatRoomsInternal: typeof chatRoomsInternal;
  http: typeof http;
  messagesInternal: typeof messagesInternal;
  mutations: typeof mutations;
  queries: typeof queries;
  sessionsInternal: typeof sessionsInternal;
  usersInternal: typeof usersInternal;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
