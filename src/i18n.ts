import { getRequestConfig } from 'next-intl/server';
import { getAuthUser } from './lib/supabase/server';
import { getProfileForRequest } from './lib/request-cache';

export default getRequestConfig(async () => {
    try {
        const user = await getAuthUser();

        if (!user) {
            // User not authenticated, fallback to English
            return {
                locale: 'en',
                messages: (await import(`../messages/en.json`)).default
            };
        }

        const profile = await getProfileForRequest(user.id);
        const locale = profile?.language || 'en';

        return {
            locale,
            messages: (await import(`../messages/${locale}.json`)).default
        };
    } catch (error) {
        // Fallback to English if profile fetch fails
        return {
            locale: 'en',
            messages: (await import(`../messages/en.json`)).default
        };
    }
});
