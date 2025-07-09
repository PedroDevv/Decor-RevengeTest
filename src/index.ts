import { findByProps, findByStoreName } from '@vendetta/metro';
import { ReactNative } from '@vendetta/metro/common';
import { after, before, instead } from '@vendetta/patcher';
import { CDN_URL, RAW_SKU_ID, SKU_ID } from './lib/constants';
import Settings from './ui/pages/Settings';
import { subscriptions as CurrentUserDecorationsStoreSubscriptions } from './lib/stores/CurrentUserDecorationsStore';
import { subscriptions as UserDecorationsStoreSubscriptions, useUsersDecorationsStore } from './lib/stores/UsersDecorationsStore';
import { unsubscribe } from './lib/stores/AuthorizationStore';

// More robust module finding with fallbacks
const findUserStore = () => {
    try {
        return findByStoreName('UserStore') || findByProps('getCurrentUser', 'getUser');
    } catch (e) {
        console.warn('[Decor] UserStore not found, trying fallback');
        return findByProps('getCurrentUser');
    }
};

const findImageResolver = () => {
    try {
        return findByProps('getAvatarDecorationURL', 'default') || findByProps('getAvatarDecorationURL');
    } catch (e) {
        console.warn('[Decor] ImageResolver not found, trying fallback');
        return findByProps('getAvatarDecorationURL') || findByProps('resolveAvatar');
    }
};

const findAvatarDecorationUtils = () => {
    try {
        return findByProps('isAnimatedAvatarDecoration') || findByProps('isAnimated');
    } catch (e) {
        console.warn('[Decor] AvatarDecorationUtils not found, trying fallback');
        return findByProps('isAnimated') || { isAnimatedAvatarDecoration: () => false };
    }
};

let UserStore, ImageResolver, AvatarDecorationUtils;
let patches = [];

export default {
    onLoad: async () => {
        try {
            // Initialize modules with error handling
            UserStore = findUserStore();
            ImageResolver = findImageResolver();
            AvatarDecorationUtils = findAvatarDecorationUtils();

            if (!UserStore) {
                console.error('[Decor] Failed to find UserStore');
                return;
            }

            if (!ImageResolver) {
                console.error('[Decor] Failed to find ImageResolver');
                return;
            }

            console.log('[Decor] Successfully found required modules');

            patches.push(unsubscribe);
            patches.push(...UserDecorationsStoreSubscriptions);
            patches.push(...CurrentUserDecorationsStoreSubscriptions);
            
            // User store patching with error handling
            if (UserStore && UserStore.getUser) {
                patches.push(
                    after('getUser', UserStore, (_, user) => {
                        try {
                            const store = useUsersDecorationsStore.getState();

                            if (user && store.has(user.id)) {
                                const decoration = store.get(user.id);
                    
                                if (decoration && user.avatarDecoration?.skuId !== SKU_ID) {
                                    user.avatarDecoration = {
                                        asset: decoration,
                                        skuId: SKU_ID
                                    };
                                } else if (!decoration && user.avatarDecoration && user.avatarDecoration?.skuId === SKU_ID) {
                                    user.avatarDecoration = null;
                                }
                    
                                user.avatarDecorationData = user.avatarDecoration;
                            }
                        } catch (e) {
                            console.warn('[Decor] Error in getUser patch:', e);
                        }
                    })
                );
            }

            // Image resolver patching with error handling
            if (ImageResolver && ImageResolver.getAvatarDecorationURL) {
                patches.push(
                    instead('getAvatarDecorationURL', ImageResolver, (args, orig) => {
                        try {
                            const [{avatarDecoration, canAnimate}] = args;
                            if (avatarDecoration?.skuId === SKU_ID) {
                                const parts = avatarDecoration.asset.split("_");
                                if (!canAnimate && parts[0] === "a") parts.shift();
                                return CDN_URL + `/${parts.join("_")}.png`;
                            } else if (avatarDecoration?.skuId === RAW_SKU_ID) {
                                return avatarDecoration.asset;
                            } else {
                                return orig(...args);
                            }
                        } catch (e) {
                            console.warn('[Decor] Error in getAvatarDecorationURL patch:', e);
                            return orig(...args);
                        }
                    })
                );
            }

            // Avatar decoration utils patching with error handling
            if (AvatarDecorationUtils && AvatarDecorationUtils.isAnimatedAvatarDecoration) {
                patches.push(
                    after('isAnimatedAvatarDecoration', AvatarDecorationUtils, ([avatarDecoration], _) => {
                        try {
                            if (ReactNative.Platform.OS === 'ios' && avatarDecoration?.asset?.startsWith('file://')) return true;
                        } catch (e) {
                            console.warn('[Decor] Error in isAnimatedAvatarDecoration patch:', e);
                        }
                    })
                );
            }

            // Initialize with current user
            const currentUser = UserStore.getCurrentUser?.() || UserStore.getUser?.();
            if (currentUser) {
                useUsersDecorationsStore.getState().fetch(currentUser.id, true);
            }

            console.log('[Decor] Plugin loaded successfully');
        } catch (e) {
            console.error('[Decor] Error during plugin load:', e);
        }
    },
    onUnload: () => {
        try {
            patches.forEach((unpatch) => {
                try {
                    unpatch();
                } catch (e) {
                    console.warn('[Decor] Error unpatching:', e);
                }
            });
            patches = [];
            console.log('[Decor] Plugin unloaded successfully');
        } catch (e) {
            console.error('[Decor] Error during plugin unload:', e);
        }
    },
    settings: Settings
};
