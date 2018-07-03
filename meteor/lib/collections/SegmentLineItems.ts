import { Mongo } from 'meteor/mongo'
import { RundownAPI } from '../../lib/api/rundown'
import { TriggerType } from 'superfly-timeline'
import { TimelineTransition,
	TimelineObjGroup,
	TimelineObjCCGVideo,
	TimelineObjLawoSource
} from './Timeline'
import { TimelineObj } from './Timeline'
import { TransformedCollection } from '../typings/meteor'

/** A trigger interface compatible with that of supertimeline */
export interface ITimelineTrigger {
	type: TriggerType
	value: number|string
}

/** A Single item in a "line": script, VT, cameras */
export interface SegmentLineItemGeneric {
	_id: string
	/** ID of the source object in MOS */
	mosId: string
	/** The segment line this item belongs to - can be undefined for global ad lib segment line items */
	segmentLineId?: string
	/** The running order this item belongs to */
	runningOrderId: string
	/** User-presentable name for the timeline item */
	name: string
	/** Timeline item trigger. Possibly, most of these will be manually triggered as next, but maybe some will be automatic. */
	trigger?: ITimelineTrigger
	/** Playback availability status */
	status: RundownAPI.LineItemStatusCode
	/** Source layer the timeline item belongs to */
	sourceLayerId: string
  	/** Layer output this segment line item belongs to */
	outputLayerId: string
	/** Expected duration of the item as planned or as estimated by the system (in case of Script layers), in milliseconds. */
	expectedDuration?: number
	/** Actual duration of the item, as played-back, in milliseconds. This value will be updated during playback for some types of items. */
	duration?: number
	/** A flag to signal a given SegmentLineItem has been deactivated manually */
	disabled?: boolean
	/** The transition used by this segment line item to transition to and from the item */
	transitions?: {
		/** In transition for the item */
		inTransition?: TimelineTransition
		/** The out transition for the item */
		outTransition?: TimelineTransition
	}
	/** The object describing the item in detail */
	content?: BaseContent
	/** The id of the item this item is a continuation of. If it is a continuation, the inTranstion must not be set, and trigger must be 0 */
	continuesRefId?: string
	/** If this item has been created play-time using an AdLibItem, this should be set to it's source item */
	adLibSourceId?: string
	/** If this item has been insterted during run of RO (such as adLibs). Df set, this won't be affected by updates from MOS */
	dynamicallyInserted?: boolean,
}

export enum SegmentLineItemLifespan {
	Normal = 0,
	OutOnNext = 1,
	Infinite = 2,
}

export interface SegmentLineItem extends SegmentLineItemGeneric {
	trigger: ITimelineTrigger
	segmentLineId: string
	expectedDuration: number
	isTransition: boolean

	/** This is set when the item is infinite, to deduplicate the contents on the timeline, while allowing out of order */
	infiniteMode?: SegmentLineItemLifespan
	infiniteId?: string

	startedPlayback?: number

	adLibSourceId?: string // only set when generated from an adlib
	dynamicallyInserted?: boolean // only set when generated from an adlib
}

export const SegmentLineItems: TransformedCollection<SegmentLineItem, SegmentLineItem>
	= new Mongo.Collection<SegmentLineItem>('segmentLineItems')
Meteor.startup(() => {
	if (Meteor.isServer) {
		SegmentLineItems._ensureIndex({
			runningOrderId: 1,
		})
	}
})
export interface MetadataElement {
	_id: string,
	key: string,
	value: string,
	source: string
}

export interface BaseContent {
	[key: string]: Array<SomeTimelineObject> | number | string | boolean | object | undefined | null
	timelineObjects?: Array<TimelineObj | null>
}

export type SomeTimelineObject = TimelineObj | TimelineObjGroup | TimelineObjCCGVideo | TimelineObjLawoSource
export interface VTContent extends BaseContent {
	fileName: string
	path: string
	firstWords: string
	lastWords: string
	proxyPath?: string
	thumbnail?: string
	loop?: boolean
	sourceDuration: number
	metadata?: Array<MetadataElement>
	timelineObjects: Array<SomeTimelineObject>
}

export interface CameraContent extends BaseContent {
	studioLabel: string
	switcherInput: number | string
	thumbnail?: string
	timelineObjects: Array<SomeTimelineObject>
}

export interface RemoteContent extends BaseContent {
	studioLabel: string
	switcherInput: string | string
	thumbnail?: string
	timelineObjects: Array<SomeTimelineObject>
}

export interface ScriptContent extends BaseContent {
	firstWords: string
	lastWords: string
	fullScript?: any
}

export interface GraphicsContent extends BaseContent {
	fileName: string
	path: string
	thumbnail?: string
	templateData?: object
	metadata?: Array<MetadataElement>
	timelineObjects: Array<SomeTimelineObject>
}

export interface SplitsContent extends BaseContent {
	dveConfiguration: any
	/** Array of contents, 0 index is DVE art */
	boxSourceConfiguration: Array<VTContent | CameraContent | RemoteContent | GraphicsContent>
	timelineObjects: Array<SomeTimelineObject>
}

export interface AudioContent extends BaseContent {
	fileName: string
	path: string
	proxyPath?: string
	loop?: boolean
	sourceDuration: number
	metadata?: Array<MetadataElement>
	timelineObjects: Array<SomeTimelineObject>
}

export interface CameraMovementContent extends BaseContent {
	cameraConfiguration: any
	timelineObjects: Array<SomeTimelineObject>
}

export interface LowerThirdContent extends GraphicsContent {
}

export interface LiveSpeakContent extends VTContent {
}

export interface MicContent extends ScriptContent {
	mixConfiguration: any
	timelineObjects: any
}
