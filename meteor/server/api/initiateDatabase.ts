import { Meteor } from 'meteor/meteor'
import { ShowStyles } from '../../lib/collections/ShowStyles'
import { StudioInstallations,
	Mappings,
	MappingCasparCG,
	MappingAtem,
	MappingAtemType,
	MappingLawo,
	Mapping,
	MappingLawoType
} from '../../lib/collections/StudioInstallations'
import { literal, getCurrentTime } from '../../lib/lib'
import { RundownAPI } from '../../lib/api/rundown'
import { PeripheralDevices, PlayoutDeviceType, PeripheralDevice } from '../../lib/collections/PeripheralDevices'
import { PeripheralDeviceAPI } from '../../lib/api/peripheralDevice'
import { logger } from '../../server/logging'
import * as _ from 'underscore'

// Imports from TSR (TODO make into an import)
// export interface Mappings {
// 	[layerName: string]: Mapping
// }
// export interface Mapping {
// 	device: PlayoutDeviceType,
// 	deviceId: string,
// 	channel?: number,
// 	layer?: number
// 	// [key: string]: any
// }

// export enum MappingAtemType {
// 	MixEffect,
// 	DownStreamKeyer,
// 	SuperSourceBox,
// 	Auxilliary,
// 	MediaPlayer
// }
// export enum PlayoutDeviceType { // moved to PlayoutDeviceType in PeripheripheralDevices
// 	ABSTRACT = 0,
// 	CASPARCG = 1,
// 	ATEM = 2,
// 	LAWO = 3,
// 	HTTPSEND = 4
// }
// const literal = <T>(o: T) => o

Meteor.methods({
	'initDB': (really) => {

		if (!really) {
			return 'Do you really want to do this? You chould only do it when initializing a new database. Confirm with initDB(true).'
		}
		logger.info('initDB')
		// Initiate database:
		StudioInstallations.upsert('studio0', {$set: {
			name: 'DKSL',
			defaultShowStyle: 'show0',
			outputLayers: [],
			config: [
				// {_id: 'nora_group', value: ''}, // Note: do not set to ensure that devs do not accidently use the live graphics channel
				// {_id: 'nora_apikey', value: ''} // Note: must not be set as apikey must be kept private
			],
		}})

		// Create outputLayers:
		StudioInstallations.update('studio0', {$set: {
			outputLayers: [
				{
					_id: 'pgm0',
					name: 'PGM',
					isPGM: true,
				},
				{
					_id: 'monitor0',
					name: 'Bakskjerm',
					isPGM: false,
				}
			],
		}})
		// Create sourceLayers:
		StudioInstallations.update('studio0', {$set: {
			sourceLayers: [
				{
					_id: 'studio0_vignett',
					_rank: 40,
					name: 'Vignett',
					type: RundownAPI.SourceLayerType.VT,
					onPGMClean: true
				},
				{
					_id: 'studio0_vb',
					_rank: 45,
					name: 'VB',
					type: RundownAPI.SourceLayerType.VT,
					onPGMClean: true
				},
				{
					_id: 'studio0_live_speak0',
					_rank: 50,
					name: 'STK',
					type: RundownAPI.SourceLayerType.LIVE_SPEAK,
					onPGMClean: true
				},
				{
					_id: 'studio0_graphics0',
					_rank: 100,
					name: 'Super',
					type: RundownAPI.SourceLayerType.GRAPHICS,
					onPGMClean: false,
					activateKeyboardHotkeys: 'a,s,d,f,g,h',
					clearKeyboardHotkey: 'l'
				},
				// {
				// 	_id: 'studio0_lower_third0',
				// 	_rank: 10,
				// 	name: 'Super',
				// 	type: RundownAPI.SourceLayerType.LOWER_THIRD,
				// 	onPGMClean: false
				// },
				{
					_id: 'studio0_split0',
					_rank: 15,
					name: 'Split',
					type: RundownAPI.SourceLayerType.SPLITS,
					onPGMClean: true,
				},
				{
					_id: 'studio0_remote0',
					_rank: 60,
					name: 'DIR',
					type: RundownAPI.SourceLayerType.REMOTE,
					onPGMClean: true,
					isRemoteInput: true
				},
				// {
				// 	_id: 'studio0_vt0',
				// 	_rank: 80,
				// 	name: 'VB',
				// 	type: RundownAPI.SourceLayerType.VT,
				// 	onPGMClean: true,
				// },
				// {
				// 	_id: 'studio0_mic0',
				// 	_rank: 90,
				// 	name: 'Mic',
				// 	type: RundownAPI.SourceLayerType.MIC,
				// 	onPGMClean: true,
				// },
				{
					_id: 'studio0_camera0',
					_rank: 100,
					name: 'Kam',
					type: RundownAPI.SourceLayerType.CAMERA,
					onPGMClean: true,
					activateKeyboardHotkeys: 'f1,f2,f3,1,2,3',
					assignHotkeysToGlobalAdlibs: true
				},
				{
					_id: 'studio0_live_transition0',
					_rank: 100,
					name: 'Transition',
					type: RundownAPI.SourceLayerType.UNKNOWN,
					onPGMClean: true,
					activateKeyboardHotkeys: '',
					assignHotkeysToGlobalAdlibs: false
				},
			],
		}})
		// Create Timeline mappings:
		const mappings: Mappings = { // Logical layers and their mappings
			'core_abstract': literal<Mapping>({
				device: PlayoutDeviceType.ABSTRACT,
				deviceId: 'abstract0',
			}),
			'casparcg_player_wipe': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 5,
				layer: 199
			}),
			'casparcg_player_vignett': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 5,
				layer: 140
			}),
			'casparcg_player_soundeffect': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 5,
				layer: 130
			}),
			'casparcg_player_clip': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 1,
				layer: 110
			}),
			'casparcg_cg_graphics': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 4,
				layer: 120
			}),
			'casparcg_cg_graphics_ctrl': literal<Mapping>({
				device: PlayoutDeviceType.HTTPSEND,
				deviceId: 'http0'
			}),
			'casparcg_cg_countdown': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 7,
				layer: 120
			}),
			'casparcg_cg_logo': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 4,
				layer: 121
			}),
			'casparcg_cg_logo_ctrl': literal<Mapping>({
				device: PlayoutDeviceType.HTTPSEND,
				deviceId: 'http0'
			}),
			'casparcg_cg_klokke_ctrl': literal<Mapping>({
				device: PlayoutDeviceType.HTTPSEND,
				deviceId: 'http0'
			}),
			'casparcg_cg_studiomonitor': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 3,
				layer: 120
			}),
			'casparcg_cg_clock': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 7,
				layer: 120
			}),
			'casparcg_cg_effects': literal<MappingCasparCG>({
				device: PlayoutDeviceType.CASPARCG,
				deviceId: 'casparcg0',
				channel: 5,
				layer: 120
			}),
			'casparcg_cg_effects_ctrl': literal<Mapping>({
				device: PlayoutDeviceType.HTTPSEND,
				deviceId: 'http0'
			}),
			'casparcg_cg_studiomonitor_ctrl': literal<Mapping>({
				device: PlayoutDeviceType.HTTPSEND,
				deviceId: 'http0'
			}),
			'atem_me_program': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.MixEffect,
				index: 0 // 0 = ME1
			}),
			'atem_me_studiomonitor': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.MixEffect,
				index: 1 // 1 = ME2
			}),
			'atem_aux_clean': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.Auxilliary,
				index: 4
			}),
			'atem_aux_preview': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.Auxilliary,
				index: 5
			}),
			'atem_dsk_graphics': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.DownStreamKeyer,
				index: 0 // 0 = DSK1
			}),
			'atem_dsk_effect': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.DownStreamKeyer,
				index: 1 // 1 = DSK2
			}),
			'atem_supersource_default': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.SuperSourceBox,
				index: 0 // 0 = SS
			}),
			'atem_supersource_override': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.SuperSourceBox,
				index: 0 // 0 = SS
			}),
			'atem_usk_effect_default': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.MixEffect,
				index: 0 // 0 = ME1
			}),
			'atem_usk_effect_override': literal<MappingAtem>({
				device: PlayoutDeviceType.ATEM,
				deviceId: 'atem0',
				mappingType: MappingAtemType.MixEffect,
				index: 0 // 0 = ME1
			}),
			'lawo_source_automix': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'AMix',
			}),
			'lawo_source_clip': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'MP1',
			}),
			'lawo_source_effect': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'FX',
			}),
			'lawo_source_rm1': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'RM1',
			}),
			'lawo_source_rm2': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'RM2',
			}),
			'lawo_source_rm3': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'RM3',
			}),
			'lawo_source_rm4': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'RM4',
			}),
			'lawo_source_rm5': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'RM4',
			}),
			'lawo_source_rm6': literal<MappingLawo>({
				device: PlayoutDeviceType.LAWO,
				deviceId: 'lawo0',
				mappingType: MappingLawoType.SOURCE,
				identifier: 'RM5',
			})
		}
		StudioInstallations.update('studio0', {$set: {
			mappings: mappings
		}})

		ShowStyles.upsert('show0', {$set: {
			name: 'Distriktsnyheter Sørlandet',
			templateMappings: [],
			baselineTemplate: 'baseline'
		}})

		PeripheralDevices.upsert('initDBPlayoutDeviceParent', {$set: literal<PeripheralDevice>({
			_id: 'initDBPlayoutDeviceParent',
			name: 'initDBPlayoutDeviceParent',
			type: PeripheralDeviceAPI.DeviceType.PLAYOUT,
			studioInstallationId: 'studio0',
			created: getCurrentTime(),
			status: {statusCode: PeripheralDeviceAPI.StatusCode.BAD},
			lastSeen: getCurrentTime(),
			connected: false,
			connectionId: null,
			token: ''
		})})

		PeripheralDevices.find({
			type: PeripheralDeviceAPI.DeviceType.PLAYOUT
		}).forEach((pd) => {
			PeripheralDevices.update(pd._id, {$set: {
				'settings.devices.casparcg0': ((pd['settings'] || {})['devices'] || {})['casparcg0'] || {
					type: PlayoutDeviceType.CASPARCG,
					options: {
						host: '160.67.87.50',
						port: 5250
					}
				},
				'settings.devices.atem0': ((pd['settings'] || {})['devices'] || {})['atem0'] || {
					type: PlayoutDeviceType.ATEM,
					options: {
						host: '160.67.87.51',
						port: 9910
					}
				},
				'settings.devices.lawo0': ((pd['settings'] || {})['devices'] || {})['lawo0'] || {
					type: PlayoutDeviceType.LAWO,
					options: {
						host: '160.67.96.51',
						port: 9000,
						sourcesPath: 'Sapphire.Sources',
						rampMotorFunctionPath: '1.5.2'
					}
				},
				'settings.devices.abstract0': ((pd['settings'] || {})['devices'] || {})['abstract0'] || {
					type: PlayoutDeviceType.ABSTRACT,
					options: {
					}
				},
				'settings.devices.http0': ((pd['settings'] || {})['devices'] || {})['http0'] || {
					type: PlayoutDeviceType.HTTPSEND,
					options: {
					}
				}
			}})
			// PeripheralDevices.update(pd._id, {$set: {
			// 	mappings: mappings
			// }})
		})
		_.each(((PeripheralDevices.findOne('initDBPlayoutDeviceParent') || {})['settings'] || {}).devices, (device, key) => {
			PeripheralDevices.upsert('initDBPlayoutDevice' + key, {$set: literal<PeripheralDevice>({
				_id: 'initDBPlayoutDevice' + key,
				name: 'initDBPlayoutDevice' + key,
				type: PeripheralDeviceAPI.DeviceType.OTHER,
				studioInstallationId: 'studio0',
				parentDeviceId: 'initDBPlayoutDeviceParent',
				created: getCurrentTime(),
				status: {statusCode: PeripheralDeviceAPI.StatusCode.BAD},
				lastSeen: getCurrentTime(),
				connected: false,
				connectionId: null,
				token: ''
			})})
		})

		PeripheralDevices.upsert('initDBMosDeviceParent', {$set: literal<PeripheralDevice>({
			_id: 'initDBMosDeviceParent',
			name: 'initDBMosDeviceParent',
			type: PeripheralDeviceAPI.DeviceType.MOSDEVICE,
			studioInstallationId: 'studio0',
			created: getCurrentTime(),
			status: {statusCode: PeripheralDeviceAPI.StatusCode.BAD},
			lastSeen: getCurrentTime(),
			connected: false,
			connectionId: null,
			token: ''
		})})

		PeripheralDevices.find({
			type: PeripheralDeviceAPI.DeviceType.MOSDEVICE
		}).forEach((pd) => {
			PeripheralDevices.update(pd._id, {$set: {
				'settings.mosId': 'SOFIE1.XPRO.MOS',
				'settings.devices.enps0': ((pd['settings'] || {})['devices'] || {})['enps0'] || {
					primary: {
						id: 'MAENPSTEST14',
						host: '160.67.149.155'
					},
					secondary: {
						id: 'MAENPSTEST15',
						host: '160.67.149.156'
					}
				},
			}})
			// PeripheralDevices.update(pd._id, {$set: {
			// 	mappings: mappings
			// }})
		})
	}
})
