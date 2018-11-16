import React, { Component } from 'react';
import { Redirect } from 'react-router-dom';
import URI from 'urijs';
import querystring from 'query-string';
import Cookie from 'universal-cookie';
import LocalStorage from '../util/LocalStorage';

const cookies = new Cookie();

class Callback extends Component {

    constructor(props) {
        super(props);
        this.authState = cookies.get('spotify_auth_state');
        this.user = cookies.get('spotify_username');
    }

    async componentDidMount() {
        await this.apiCallback(querystring.parse(this.props.location.search));
    }

    render() {
        return (
            <div>
                Callback baby!

                {/* {JSON.stringify(querystring.parse(this.props.location.search))}

                Auth state: {this.authState}<br/><br/>
        User: {JSON.stringify(this.user)} */} 
            </div>
        );
    }

    async apiCallback(queryParamObj) {
        console.log('asd ' + JSON.stringify(queryParamObj));
        const res = await fetch('/user/callback', {
            method: 'post', 
            headers: {'Content-Type': 'application/json'}, 
            body: JSON.stringify(queryParamObj),
            redirect: 'follow'
        });
        console.log(res);
        const uri = new URI(res.url); 
        const qs = querystring.parse(uri.query());
        console.log(JSON.parse(qs.user));
        LocalStorage.insert('spotifier_user', qs.user);
        this.props.history.push(uri.path());
    }

    getPathFromUrl(url) {
        return url.split("?")[0];
    }

}

export default Callback;