import * as ClassNames from 'classnames'
import * as React from 'react'
import { translate } from 'react-i18next'
import * as _ from 'underscore'
import { PeripheralDeviceAPI } from '../../../lib/api/peripheralDevice'
import { PeripheralDevice,
	PeripheralDevices,
	PlayoutDeviceType,
	PlayoutDeviceSettings,
	PlayoutDeviceSettingsDevice,
	MosDeviceSettings,
	MosDeviceSettingsDevice
} from '../../../lib/collections/PeripheralDevices'
import { EditAttribute, EditAttributeBase } from '../../lib/EditAttribute'
import { ModalDialog } from '../../lib/ModalDialog'
import { Translated, translateWithTracker } from '../../lib/ReactMeteorData/react-meteor-data'
import { Spinner } from '../../lib/Spinner'
import * as faTrash from '@fortawesome/fontawesome-free-solid/faTrash'
import * as faPencilAlt from '@fortawesome/fontawesome-free-solid/faPencilAlt'
import * as faCheck from '@fortawesome/fontawesome-free-solid/faCheck'
import * as faPlus from '@fortawesome/fontawesome-free-solid/faPlus'
import * as FontAwesomeIcon from '@fortawesome/react-fontawesome'

interface IPlayoutDeviceSettingsComponentProps {
	device: PeripheralDevice
}

interface IPlayoutDeviceSettingsComponentState {
	deleteConfirmDeviceId: string | undefined
	showDeleteConfirm: boolean
	editedDevices: Array<string>
}
const PlayoutDeviceSettingsComponent = translate()(
class PlayoutDeviceSettingsComponent extends React.Component<Translated<IPlayoutDeviceSettingsComponentProps>, IPlayoutDeviceSettingsComponentState> {
	constructor (props: Translated<IPlayoutDeviceSettingsComponentProps>) {
		super(props)

		this.state = {
			deleteConfirmDeviceId: undefined,
			showDeleteConfirm: false,
			editedDevices: []
		}
	}

	isItemEdited = (deviceId: string) => {
		return this.state.editedDevices.indexOf(deviceId) >= 0
	}

	finishEditItem = (deviceId: string) => {
		let index = this.state.editedDevices.indexOf(deviceId)
		if (index >= 0) {
			this.state.editedDevices.splice(index, 1)
			this.setState({
				editedDevices: this.state.editedDevices
			})
		}
	}

	editItem = (deviceId: string) => {
		if (this.state.editedDevices.indexOf(deviceId) < 0) {
			this.state.editedDevices.push(deviceId)
			this.setState({
				editedDevices: this.state.editedDevices
			})
		}
	}
	handleConfirmRemoveCancel = (e) => {
		this.setState({
			showDeleteConfirm: false,
			deleteConfirmDeviceId: undefined
		})
	}

	handleConfirmRemoveAccept = (e) => {
		this.state.deleteConfirmDeviceId && this.removeDevice(this.state.deleteConfirmDeviceId)
		this.setState({
			showDeleteConfirm: false,
			deleteConfirmDeviceId: undefined
		})
	}

	confirmRemove = (deviceId: string) => {
		this.setState({
			showDeleteConfirm: true,
			deleteConfirmDeviceId: deviceId
		})
	}

	removeDevice = (deviceId: string) => {
		let unsetObject = {}
		unsetObject['settings.devices.' + deviceId] = ''
		PeripheralDevices.update(this.props.device._id, {
			$unset: unsetObject
		})
	}
	addNewDevice = () => {
		let settings = this.props.device.settings as PlayoutDeviceSettings || {}
		// find free key name
		let newDeviceId = 'newDevice'
		let iter = 0
		while ((settings.devices || {})[newDeviceId + iter.toString()]) {
			iter++
		}
		let setObject = {}
		setObject['settings.devices.' + newDeviceId + iter.toString()] = {
			type: PlayoutDeviceType.ABSTRACT,
			options: {}
		}

		PeripheralDevices.update(this.props.device._id, {
			$set: setObject
		})
	}
	updateDeviceId = (edit: EditAttributeBase, newValue: string) => {
		let settings = this.props.device.settings as PlayoutDeviceSettings

		let oldDeviceId = edit.props.overrideDisplayValue
		let newDeviceId = newValue + ''
		let device = settings.devices[oldDeviceId]

		if (settings[newDeviceId]) {
			throw new Meteor.Error(400, 'Device "' + newDeviceId + '" already exists')
		}

		let mSet = {}
		let mUnset = {}
		mSet['settings.devices.' + newDeviceId] = device
		mUnset['settings.devices.' + oldDeviceId] = 1

		edit.props.collection.update(this.props.device._id, {
			$set: mSet,
			$unset: mUnset
		})
		this.finishEditItem(oldDeviceId)
		this.editItem(newDeviceId)
	}
	renderDevices () {
		let settings = this.props.device.settings as PlayoutDeviceSettings

		const { t } = this.props

		return _.map(settings.devices, (device: PlayoutDeviceSettingsDevice, deviceId) => {
			return (
				!this.isItemEdited(deviceId) ?
				<tr key={deviceId}>
					<th className='settings-studio-device__name c5'>
						{deviceId}
					</th>
					<td className='settings-studio-device__id c4'>
						{PlayoutDeviceType[device.type]}
					</td>
					<td className='settings-studio-device__actions table-item-actions c3'>
						<button className='action-btn' onClick={(e) => this.editItem(deviceId)}>
							<FontAwesomeIcon icon={faPencilAlt} />
						</button>
						<button className='action-btn' onClick={(e) => this.confirmRemove(deviceId)}>
							<FontAwesomeIcon icon={faTrash} />
						</button>
					</td>
				</tr> :
				<tr className='expando-details hl' key={deviceId + '-details'}>
					<td colSpan={5}>
						<div>
							<div className='mod mvs mhs'>
								<label className='field'>
									{t('Device ID')}
									<EditAttribute
										modifiedClassName='bghl'
										attribute={'settings.devices' }
										overrideDisplayValue={deviceId }
										obj={this.props.device}
										type='text'
										collection={PeripheralDevices}
										updateFunction={this.updateDeviceId}
										className='input text-input input-l'></EditAttribute>
								</label>
							</div>
							<div className='mod mvs mhs'>
								<label className='field'>
									{t('Device Type')}
									<EditAttribute
										modifiedClassName='bghl'
										attribute={'settings.devices.' + deviceId + '.type' }
										obj={this.props.device}
										type='dropdown'
										options={PlayoutDeviceType}
										optionsAreNumbers={true}
										collection={PeripheralDevices}
										className='input text-input input-l'></EditAttribute>
								</label>
							</div>
							{(
								device.type === PlayoutDeviceType.CASPARCG && (
									(
									<React.Fragment>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Host')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.host' }
													obj={this.props.device}
													type='text'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Port')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.port' }
													obj={this.props.device}
													type='int'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Playout uses Timecode of Caspar')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.syncTimecode' }
													obj={this.props.device}
													type='checkbox'
													collection={PeripheralDevices}
													className=''></EditAttribute>
											</label>
										</div>
									</React.Fragment>
									)
								) ||
								(
								device.type === PlayoutDeviceType.ATEM && (
									(
									<React.Fragment>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Host')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.host'}
													obj={this.props.device}
													type='text'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Port')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.port'}
													obj={this.props.device}
													type='int'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
									</React.Fragment>
									)
								))
								) ||
								(
								device.type === PlayoutDeviceType.LAWO && (
									(
									<React.Fragment>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Host')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.host'}
													obj={this.props.device}
													type='text'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Port')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.port'}
													obj={this.props.device}
													type='int'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Sources Path')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.sourcesPath'}
													obj={this.props.device}
													type='text'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
										<div className='mod mvs mhs'>
											<label className='field'>
												{t('Ramp Function Path')}
												<EditAttribute
													modifiedClassName='bghl'
													attribute={'settings.devices.' + deviceId + '.options.rampMotorFunctionPath'}
													obj={this.props.device}
													type='text'
													collection={PeripheralDevices}
													className='input text-input input-l'></EditAttribute>
											</label>
										</div>
									</React.Fragment>
									)
								))
							}
						</div>
						<div className='mod alright'>
							<button className={ClassNames('btn btn-primary')} onClick={(e) => this.finishEditItem(deviceId)}>
								<FontAwesomeIcon icon={faCheck} />
							</button>
						</div>
					</td>
				</tr>
			)
		})
	}
	render () {
		const { t } = this.props

		let settings = this.props.device.settings as PlayoutDeviceSettings

		return (
			<div>
				<label className='field'>
					{t('Initialize as clear')}
					<EditAttribute
						modifiedClassName='bghl'
						attribute={'initializeAsClear'}
						obj={this.props.device}
						type='checkbox'
						collection={PeripheralDevices}
						className=''></EditAttribute>
				</label>

				<ModalDialog title={t('Remove this device?')} acceptText={t('Remove')} secondaryText={t('Cancel')} show={this.state.showDeleteConfirm} onAccept={(e) => this.handleConfirmRemoveAccept(e)} onSecondary={(e) => this.handleConfirmRemoveCancel(e)}>
					<p>{t('Are you sure you want to remove device ') + (this.state.deleteConfirmDeviceId && this.state.deleteConfirmDeviceId) + '?'}</p>
				</ModalDialog>

				{settings && settings.devices &&
					(
						<React.Fragment>
							<h3>{t('Attached devices')}</h3>
							<table className='expando settings-studio-device-table'>
								<tbody>
									{this.renderDevices()}
								</tbody>
							</table>
						</React.Fragment>
					)
				}

				<div className='mod mhs'>
					<button className='btn btn-primary' onClick={(e) => this.addNewDevice()}>
						<FontAwesomeIcon icon={faPlus} />
					</button>
				</div>
			</div>
		)
	}
})

interface IMosDeviceSettingsComponentState {
	deleteConfirmDeviceId: string | undefined
	showDeleteConfirm: boolean
	editedDevices: Array<string>
}
const MosDeviceSettingsComponent = translate()(
class MosDeviceSettingsComponent extends React.Component<Translated<IPlayoutDeviceSettingsComponentProps>, IMosDeviceSettingsComponentState> {
	constructor (props: Translated<IPlayoutDeviceSettingsComponentProps>) {
		super(props)

		this.state = {
			deleteConfirmDeviceId: undefined,
			showDeleteConfirm: false,
			editedDevices: []
		}
	}

	isItemEdited = (deviceId: string) => {
		return this.state.editedDevices.indexOf(deviceId) >= 0
	}
	finishEditItem = (deviceId: string) => {
		let index = this.state.editedDevices.indexOf(deviceId)
		if (index >= 0) {
			this.state.editedDevices.splice(index, 1)
			this.setState({
				editedDevices: this.state.editedDevices
			})
		}
	}
	editItem = (deviceId: string) => {
		if (this.state.editedDevices.indexOf(deviceId) < 0) {
			this.state.editedDevices.push(deviceId)
			this.setState({
				editedDevices: this.state.editedDevices
			})
		}
	}
	handleConfirmRemoveCancel = (e) => {
		this.setState({
			showDeleteConfirm: false,
			deleteConfirmDeviceId: undefined
		})
	}
	handleConfirmRemoveAccept = (e) => {
		this.state.deleteConfirmDeviceId && this.removeDevice(this.state.deleteConfirmDeviceId)
		this.setState({
			showDeleteConfirm: false,
			deleteConfirmDeviceId: undefined
		})
	}
	confirmRemove = (deviceId: string) => {
		this.setState({
			showDeleteConfirm: true,
			deleteConfirmDeviceId: deviceId
		})
	}
	removeDevice = (deviceId: string) => {
		let unsetObject = {}
		unsetObject['settings.devices.' + deviceId] = ''
		PeripheralDevices.update(this.props.device._id, {
			$unset: unsetObject
		})
	}
	addNewDevice = () => {
		let settings = this.props.device.settings as PlayoutDeviceSettings || {}
		// find free key name
		let newDeviceId = 'mosDevice'
		let iter = 0
		while ((settings.devices || {})[newDeviceId + iter.toString()]) {
			iter++
		}
		let setObject = {}
		setObject['settings.devices.' + newDeviceId + iter.toString()] = {
			primary: {
				id: 'MOSSERVERID',
				host: ''
			}
		}

		PeripheralDevices.update(this.props.device._id, {
			$set: setObject
		})
	}
	updateDeviceId = (edit: EditAttributeBase, newValue: string) => {
		let settings = this.props.device.settings as MosDeviceSettings

		let oldDeviceId = edit.props.overrideDisplayValue
		let newDeviceId = newValue + ''
		let device = settings.devices[oldDeviceId]

		if (settings[newDeviceId]) {
			throw new Meteor.Error(400, 'Device "' + newDeviceId + '" already exists')
		}

		let mSet = {}
		let mUnset = {}
		mSet['settings.devices.' + newDeviceId] = device
		mUnset['settings.devices.' + oldDeviceId] = 1

		edit.props.collection.update(this.props.device._id, {
			$set: mSet,
			$unset: mUnset
		})
		this.finishEditItem(oldDeviceId)
		this.editItem(newDeviceId)
	}
	renderDevices () {
		let settings = this.props.device.settings as MosDeviceSettings

		const { t } = this.props

		return ([
			<tr className='hl' key={'header'}>
				<th>DeviceId</th>
				<th>Primary ID</th>
				<th>Host</th>
				<th>Secondary ID</th>
				<th>Host</th>
				<th></th>
			</tr>
		].concat(
			_.map(settings.devices, (device: MosDeviceSettingsDevice, deviceId) => {
				return (
					!this.isItemEdited(deviceId) ?
					<tr key={deviceId}>
						<th className='settings-studio-device__name c1'>
							{deviceId}
						</th>
						<td className='settings-studio-device__primary_id c3'>
							{(device.primary || {id: ''}).id}
						</td>
						<td className='settings-studio-device__primary_host c2'>
							{(device.primary || {host: ''}).host}
						</td>
						<td className='settings-studio-device__secondary_id c3'>
							{(device.secondary || {id: ''}).id}
						</td>
						<td className='settings-studio-device__secondary_host c2'>
							{(device.secondary || {host: ''}).host}
						</td>
						<td className='settings-studio-device__actions table-item-actions c1'>
							<button className='action-btn' onClick={(e) => this.editItem(deviceId)}>
								<FontAwesomeIcon icon={faPencilAlt} />
							</button>
							<button className='action-btn' onClick={(e) => this.confirmRemove(deviceId)}>
								<FontAwesomeIcon icon={faTrash} />
							</button>
						</td>
					</tr> :
					<tr className='expando-details hl' key={deviceId + '-details'}>
						<td colSpan={6}>
							<div>
								<div className='mod mvs mhs'>
									<label className='field'>
										{t('Device ID')}
										<EditAttribute
											modifiedClassName='bghl'
											attribute={'settings.devices' }
											overrideDisplayValue={deviceId }
											obj={this.props.device}
											type='text'
											collection={PeripheralDevices}
											updateFunction={this.updateDeviceId}
											className='input text-input input-l'></EditAttribute>
									</label>
								</div>
								<div className='mod mvs mhs'>
									<label className='field'>
										{t('Primary id (their mosId)')}
										<EditAttribute
											modifiedClassName='bghl'
											attribute={'settings.devices.' + deviceId + '.primary.id' }
											obj={this.props.device}
											type='text'
											collection={PeripheralDevices}
											className='input text-input input-l'></EditAttribute>
									</label>
								</div>
								<div className='mod mvs mhs'>
									<label className='field'>
										{t('Primary host (ip or hostname)')}
										<EditAttribute
											modifiedClassName='bghl'
											attribute={'settings.devices.' + deviceId + '.primary.host' }
											obj={this.props.device}
											type='text'
											collection={PeripheralDevices}
											className='input text-input input-l'></EditAttribute>
									</label>
								</div>
								<div className='mod mvs mhs'>
									<label className='field'>
										{t('Secondary id (their mosId)')}
										<EditAttribute
											modifiedClassName='bghl'
											attribute={'settings.devices.' + deviceId + '.secondary.id' }
											obj={this.props.device}
											type='text'
											collection={PeripheralDevices}
											className='input text-input input-l'></EditAttribute>
									</label>
								</div>
								<div className='mod mvs mhs'>
									<label className='field'>
										{t('Secondary host (ip or hostname)')}
										<EditAttribute
											modifiedClassName='bghl'
											attribute={'settings.devices.' + deviceId + '.secondary.host' }
											obj={this.props.device}
											type='text'
											collection={PeripheralDevices}
											className='input text-input input-l'></EditAttribute>
									</label>
								</div>
							</div>
							<div className='mod alright'>
								<button className={ClassNames('btn btn-primary')} onClick={(e) => this.finishEditItem(deviceId)}>
									<FontAwesomeIcon icon={faCheck} />
								</button>
							</div>
						</td>
					</tr>
				)
			})
		))
	}
	render () {
		const { t } = this.props

		let settings = this.props.device.settings as PlayoutDeviceSettings

		return (
			<div>
				<label className='field'>
					{t('MosId of gateway (our mosId)')}
					<EditAttribute
						modifiedClassName='bghl'
						attribute={'settings.mosId'}
						obj={this.props.device}
						type='text'
						collection={PeripheralDevices}
						className=''></EditAttribute>
				</label>

				<ModalDialog title={t('Remove this device?')} acceptText={t('Remove')} secondaryText={t('Cancel')} show={this.state.showDeleteConfirm} onAccept={(e) => this.handleConfirmRemoveAccept(e)} onSecondary={(e) => this.handleConfirmRemoveCancel(e)}>
					<p>{t('Are you sure you want to remove device ') + (this.state.deleteConfirmDeviceId && this.state.deleteConfirmDeviceId) + '?'}</p>
				</ModalDialog>

				{settings && settings.devices &&
					(
						<React.Fragment>
							<h3>{t('Mos-devices')}</h3>
							<table className='expando settings-studio-device-table'>
								<tbody>
									{this.renderDevices()}
								</tbody>
							</table>
						</React.Fragment>
					)
				}

				<div className='mod mhs'>
					<button className='btn btn-primary' onClick={(e) => this.addNewDevice()}>
						<FontAwesomeIcon icon={faPlus} />
					</button>
				</div>

			</div>
		)
	}
})

interface IDeviceSettingsProps {
	match: {
		params: {
			deviceId: string
		}
	}
}
interface IDeviceSettingsState {
}
interface IDeviceSettingsTrackedProps {
	device?: PeripheralDevice
}
export default translateWithTracker<IDeviceSettingsProps, IDeviceSettingsState, IDeviceSettingsTrackedProps>(
(props: IDeviceSettingsProps) => {
	return {
		device: PeripheralDevices.findOne(props.match.params.deviceId)
	}
})(
class DeviceSettings extends React.Component<Translated<IDeviceSettingsProps & IDeviceSettingsTrackedProps>> {

	findHighestRank (array: Array<{ _rank: number }>): { _rank: number } | null {
		let max: { _rank: number } | null = null

		array.forEach((value, index) => {
			if (max == null || max._rank < value._rank) {
				max = value
			}
		})

		return max
	}

	renderSpecifics () {
		if (this.props.device) {
			switch (this.props.device.type) {
				case PeripheralDeviceAPI.DeviceType.MOSDEVICE:
					return <MosDeviceSettingsComponent
						device={this.props.device}
					/>
				case PeripheralDeviceAPI.DeviceType.PLAYOUT:
					return <PlayoutDeviceSettingsComponent
						device={this.props.device}
					/>
			}
		}
		return null
	}

	renderEditForm () {
		const { t } = this.props

		return (
			<div className='studio-edit mod mhl mvs'>
				<div>
					<h3>{t('Generic properties')}</h3>
					<label className='field'>
						{t('Device name')}
						<div className='mdi'>
							<EditAttribute
								modifiedClassName='bghl'
								attribute='name'
								obj={this.props.device}
								type='text'
								collection={PeripheralDevices}
								className='mdinput'></EditAttribute>
							<span className='mdfx'></span>
						</div>
					</label>

					{this.renderSpecifics()}
				</div>
			</div>
		)
	}

	render () {
		const { t } = this.props

		if (this.props.device) {
			return this.renderEditForm()
		} else {
			return <Spinner />
		}
	}
}
)
