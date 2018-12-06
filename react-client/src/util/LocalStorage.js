export default class LocalStorage {
    static SPOTIFIER_USER = 'spotifier_user';
    static SPOTIFIER_SEARCH_PREFS = 'spotifier_search_prefs';

    static insert(key, value) {
        try {
            localStorage.setItem(key, Buffer.from(value).toString('base64'));
        } catch (e) {
            console.log(e);
        }
    }

    static get(key, decode) {
        let str = "";
        try {
            const val = localStorage.getItem(key);
            if (decode && decode === true)
                str = Buffer.from(val, 'base64');
            else
                str = val;
        } catch (e) {
            console.log(e)
        }
        return str;
    }
}