import { Meteor } from 'meteor/meteor'
import * as React from 'react'
import { Translated } from '../lib/ReactMeteorData/react-meteor-data'
import * as _ from 'underscore'
import { translate } from 'react-i18next'

import {
	Route,
	Switch,
	Redirect,
	Link,
	NavLink
} from 'react-router-dom'
import SystemStatus from './Status/SystemStatus'
import { ExternalMessages } from './Status/ExternalMessages'

class WelcomeToStatus extends React.Component {
	render () {
		return (<div></div>)
	}
}
interface IStatusMenuProps {
	match?: any
}
interface IStatusMenuState {
}
const StatusMenu = translate()(class StatusMenu extends React.Component<Translated<IStatusMenuProps>, IStatusMenuState> {

	render () {
		const { t } = this.props

		return (
			<div className='tight-xs htight-xs text-s'>
				<NavLink
					activeClassName='selectable-selected'
					className='status-menu__status-menu-item selectable clickable'
					key='system-link'
					to={'/status/system'}>
					<h3>{t('System')}</h3>
				</NavLink>
				<NavLink
					activeClassName='selectable-selected'
					className='status-menu__status-menu-item selectable clickable'
					key='messages-link'
					to={'/status/messages'}>
					<h3>{t('Messages')}</h3>
				</NavLink>
			</div>
		)
	}
})

interface IStatusProps {
	match?: any
}
class Status extends React.Component<Translated<IStatusProps>> {
	private _subscriptions: Array<Meteor.SubscriptionHandle> = []
	componentWillMount () {
		// Subscribe to data:

		this._subscriptions.push(Meteor.subscribe('peripheralDevices', {}))
		this._subscriptions.push(Meteor.subscribe('studioInstallations', {}))
		this._subscriptions.push(Meteor.subscribe('showStyles', {}))
		this._subscriptions.push(Meteor.subscribe('runtimeFunctions', {}))
	}
	componentWillUnmount () {
		_.each(this._subscriptions, (sub ) => {
			sub.stop()
		})
	}
	render () {
		const { t } = this.props

		return (
			<div className='mtl gutter'>
				<header className='mvs'>
					<h1>{t('Status')}</h1>
				</header>
				<div className='mod mvl mhs'>
					<div className='row'>
						<div className='col c12 rm-c1 status-menu'>
							<StatusMenu match={this.props.match} />
						</div>
						<div className='col c12 rm-c11 status-dialog'>
							<Switch>
								{/* <Route path='/status' exact component={WelcomeToStatus} /> */}
								<Route path='/status/messages' component={ExternalMessages} />
								<Route path='/status/system' component={SystemStatus} />
								<Redirect to='/status/system' />
							</Switch>
						</div>
					</div>
				</div>
			</div>
		)
	}
}

export default translate()(Status)
