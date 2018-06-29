import { Meteor } from 'meteor/meteor'
import { RunningOrders, RunningOrder } from '../../lib/collections/RunningOrders'
import { SegmentLine, SegmentLines } from '../../lib/collections/SegmentLines'
import { SegmentLineItem, SegmentLineItems, ITimelineTrigger, SegmentLineItemLifespan } from '../../lib/collections/SegmentLineItems'
import { SegmentLineAdLibItems, SegmentLineAdLibItem } from '../../lib/collections/SegmentLineAdLibItems'
import { RunningOrderBaselineItems, RunningOrderBaselineItem } from '../../lib/collections/RunningOrderBaselineItems'
import { getCurrentTime, saveIntoDb, literal, Time } from '../../lib/lib'
import { Timeline, TimelineObj, TimelineObjGroupSegmentLine, TimelineContentTypeOther, TimelineObjAbstract, TimelineObjAbstract2, TimelineObjGroup, TimelineContentTypeLawo, TimelineObjLawo } from '../../lib/collections/Timeline'
import { TriggerType } from 'superfly-timeline'
import { Segments, Segment } from '../../lib/collections/Segments'
import { Random } from 'meteor/random'
import * as _ from 'underscore'
import { logger } from './../logging'
import { PeripheralDevice, PeripheralDevices, PlayoutDeviceSettings } from '../../lib/collections/PeripheralDevices'
import { PeripheralDeviceAPI } from '../../lib/api/peripheralDevice'
import { IMOSRunningOrder, IMOSObjectStatus, MosString128 } from 'mos-connection'
import { PlayoutTimelinePrefixes } from '../../lib/api/playout'
import { TemplateContext, TemplateResultAfterPost, runNamedTemplate } from './templates/templates'
import { RunningOrderBaselineAdLibItem, RunningOrderBaselineAdLibItems } from '../../lib/collections/RunningOrderBaselineAdLibItems'
import { sendStoryStatus, segmentId } from './peripheralDevice'

Meteor.methods({
	/**
	 * Activates the RunningOrder:
	 * TODO: Set up the Timeline
	 * Set first item on Next queue
	 */
	'playout_reload_data': (roId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)

		PeripheralDeviceAPI.executeFunction(runningOrder.mosDeviceId, (err: any, ro: IMOSRunningOrder) => {
			if (err) {
				logger.error(err)
			} else {
				// TODO: what to do with the result?
				logger.debug('Recieved reply for triggerGetRunningOrder', ro)
			}
		}, 'triggerGetRunningOrder', runningOrder.mosId)
	},
	'playout_activate': (roId: string, rehearsal: boolean) => {
		rehearsal = !!rehearsal
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)

		let wasInactive = !runningOrder.active

		let studioInstallation = runningOrder.getStudioInstallation()

		let playoutDevices = PeripheralDevices.find({
			studioInstallationId: studioInstallation._id,
			type: PeripheralDeviceAPI.DeviceType.PLAYOUT
		}).fetch()
		// PeripheralDevices.find()

		_.each(playoutDevices, (device: PeripheralDevice) => {
			let okToDestoryStuff = wasInactive
			PeripheralDeviceAPI.executeFunction(device._id, (err, res) => {
				if (err) {
					logger.error(err)
				} else {
					logger.info('devicesMakeReady OK')
				}
			}, 'devicesMakeReady', okToDestoryStuff)
		})

		let anyOtherActiveRunningOrders = RunningOrders.find({
			studioInstallationId: runningOrder.studioInstallationId,
			active: true
		}).fetch()

		if (anyOtherActiveRunningOrders.length) {
			throw new Meteor.Error(400, 'Only one running-order can be active at the same time. Active runningOrders: ' + _.pluck(anyOtherActiveRunningOrders,'_id'))
		}
		logger.info('Activating RO ' + roId + (rehearsal ? ' (Rehearsal)' : ''))

		let segmentLines = runningOrder.getSegmentLines()

		SegmentLines.update({ runningOrderId: runningOrder._id }, { $unset: {
			startedPlayback: 0,
			duration: 0
		}}, {
			multi: true
		})

		// Remove all segment line items that have been dynamically created (such as adLib items)
		SegmentLineItems.remove({
			runningOrderId: runningOrder._id,
			dynamicallyInserted: true
		})

		// ensure that any removed infinites (caused by adlib) are restored
		updateSourceLayerInfinitesAfterLine(runningOrder, true)

		// Remove duration on segmentLineItems, as this is set by the ad-lib playback editing
		SegmentLineItems.update({ runningOrderId: runningOrder._id }, { $unset: {
			startedPlayback: 0,
			duration: 0
		}}, {
			multi: true
		})

		RunningOrders.update(runningOrder._id, {$set: {
			active: true,
			rehearsal: rehearsal,
			previousSegmentLineId: null,
			currentSegmentLineId: null,
			nextSegmentLineId: segmentLines[0]._id, // put the first on queue
			updateStoryStatus: null
		}, $unset: {
			startedPlayback: 0
		}})

		logger.info('Building baseline items...')

		const showStyle = runningOrder.getShowStyle()
		if (showStyle.baselineTemplate) {
			const result: TemplateResultAfterPost = runNamedTemplate(showStyle, showStyle.baselineTemplate, literal<TemplateContext>({
				runningOrderId: runningOrder._id,
				segmentLine: runningOrder.getSegmentLines()[0]
			}), {
				// Dummy object, not used in this template:
				RunningOrderId: new MosString128(''),
				Body: [],
				ID: new MosString128(''),

			})

			if (result.baselineItems) {
				logger.info(`... got ${result.baselineItems.length} items from template.`)
				saveIntoDb<RunningOrderBaselineItem, RunningOrderBaselineItem>(RunningOrderBaselineItems, {
					runningOrderId: runningOrder._id
				}, result.baselineItems)
			}

			if (result.segmentLineAdLibItems) {
				logger.info(`... got ${result.segmentLineAdLibItems.length} adLib items from template.`)
				saveIntoDb<RunningOrderBaselineAdLibItem, RunningOrderBaselineAdLibItem>(RunningOrderBaselineAdLibItems, {
					runningOrderId: runningOrder._id
				}, result.segmentLineAdLibItems)
			}
		}

		updateTimeline(runningOrder.studioInstallationId)
	},
	/**
	 * Inactivates the RunningOrder
	 * TODO: Clear the Timeline (?)
	 */
	'playout_inactivate': (roId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)

		logger.info('Inactivating RO ' + roId )

		let previousSegmentLine = (runningOrder.currentSegmentLineId ?
			SegmentLines.findOne(runningOrder.currentSegmentLineId)
			: null
		)
		RunningOrders.update(runningOrder._id, {$set: {
			active: false,
			previousSegmentLineId: null,
			currentSegmentLineId: null,
			nextSegmentLineId: null
		}})

		// clean up all runtime baseline items
		RunningOrderBaselineItems.remove({
			runningOrderId: runningOrder._id
		})

		RunningOrderBaselineAdLibItems.remove({
			runningOrderId: runningOrder._id
		})

		updateTimeline(runningOrder.studioInstallationId)

		sendStoryStatus(runningOrder, null)
	},

	'debug__printTime': () => {
		let now = getCurrentTime()
		logger.debug(new Date(now))
		return now
	},

	/**
	 * Perform the TAKE action, i.e start playing a segmentLineItem
	 */
	'playout_take': (roId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)
		if (!runningOrder.nextSegmentLineId) throw new Meteor.Error(500, 'nextSegmentLineId is not set!')

		let previousSegmentLine = (runningOrder.currentSegmentLineId ?
			SegmentLines.findOne(runningOrder.currentSegmentLineId)
			: null
		)
		let takeSegmentLine = SegmentLines.findOne(runningOrder.nextSegmentLineId)
		if (!takeSegmentLine) throw new Meteor.Error(404, 'takeSegmentLine not found!')
		let takeSegment = Segments.findOne(takeSegmentLine.segmentId)

		let segmentLinesAfter = runningOrder.getSegmentLines({
			_rank: {
				$gt: takeSegmentLine._rank,
			},
			_id: {$ne: takeSegmentLine._id}
		})

		let nextSegmentLine: SegmentLine | null = segmentLinesAfter[0] || null

		RunningOrders.update(runningOrder._id, {$set: {
			previousSegmentLineId: runningOrder.currentSegmentLineId,
			currentSegmentLineId: takeSegmentLine._id,
			nextSegmentLineId: nextSegmentLine ? nextSegmentLine._id : null
		}})

		if (nextSegmentLine) {
			clearNextLineStartedPlaybackAndDuration(roId, nextSegmentLine._id)
		}

		updateTimeline(runningOrder.studioInstallationId)

		if (takeSegmentLine.updateStoryStatus) {
			sendStoryStatus(runningOrder, takeSegmentLine)
		}
	},

	'playout_setNext': (roId: string, nextSlId: string) => {

		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)

		RunningOrders.update(runningOrder._id, {$set: {
			nextSegmentLineId: nextSlId
		}})

		clearNextLineStartedPlaybackAndDuration(roId, nextSlId)

		// remove old auto-next from timeline, and add new one
		updateTimeline(runningOrder.studioInstallationId)
	},

	'playout_segmentLineItemPlaybackStart': (roId: string, sliId: string, startedPlayback: Time) => {
		// This method is called when an auto-next event occurs
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)
		let segLineItem = SegmentLineItems.findOne({
			_id: sliId,
			runningOrderId: roId
		})
		if (!segLineItem) {
			throw new Meteor.Error(404, `Segment line item "${sliId}" in running order "${roId}" not found!`)
		}

		let segLine = SegmentLines.findOne({
			_id: segLineItem.segmentLineId,
			runningOrderId: roId
		})
		if (!segLine) {
			throw new Meteor.Error(404, `Segment line "${segLineItem._id}" in running order "${roId}" not found!`)
		}

		if (!segLineItem.startedPlayback) {
			logger.info(`Playout reports segment line item "${sliId}" has started playback on timestamp ${(new Date(startedPlayback)).toISOString()}`)

			let itemsToStop = segLine.getSegmentLinesItems().filter(l => l.infiniteMode && segLineItem && l.sourceLayerId === segLineItem.sourceLayerId && segLineItem._id !== l._id)
			itemsToStop.forEach(l => {
				let duration = 1
				if (l.startedPlayback) {
					duration = startedPlayback - l.startedPlayback
				}
				if (duration === 0) {
					duration = 1
				}

				logger.info('set duration of ' + l._id + ': ' + duration + ' (started: ' + l.startedPlayback + ')')

				SegmentLineItems.update(l._id, {$set: {
					duration
				}})
			})

			// store new value
			SegmentLineItems.update(segLineItem._id, {$set: {
				startedPlayback
			}})

			// startedPlayback changes nothing, so only update if any durations were set
			if (itemsToStop.length > 0) {
				updateTimeline(runningOrder.studioInstallationId)
			}
		}
	},

	'playout_segmentLinePlaybackStart': (roId: string, slId: string, startedPlayback: Time) => {
		// This method is called when an auto-next event occurs
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)
		let segLine = SegmentLines.findOne({
			_id: slId,
			runningOrderId: roId
		})

		if (segLine) {
			// make sure we don't run multiple times, even if TSR calls us multiple times
			if (!segLine.startedPlayback) {
				logger.info(`Playout reports segment line "${slId}" has started playback on timestamp ${(new Date(startedPlayback)).toISOString()}`)

				if (runningOrder.currentSegmentLineId === slId) {
					// this is the current segment line, it has just started playback
					if (runningOrder.previousSegmentLineId) {
						let prevSegLine = SegmentLines.findOne(runningOrder.previousSegmentLineId)

						if (!prevSegLine) {
							// We couldn't find the previous segment line: this is not a critical issue, but is clearly is a symptom of a larger issue
							logger.error(`Previous segment line "${runningOrder.previousSegmentLineId}" on running order "${roId}" could not be found.`)
						} else if (!prevSegLine.duration) {
							setPreviousLinePlaybackDuration(roId, prevSegLine, startedPlayback)
						}
					}

					setRunningOrderStartedPlayback(runningOrder, startedPlayback) // Set startedPlayback on the running order if this is the first item to be played
				} else if (runningOrder.nextSegmentLineId === slId) {
					// this is the next segment line, clearly an autoNext has taken place
					if (runningOrder.currentSegmentLineId) {
						let prevSegLine = SegmentLines.findOne(runningOrder.currentSegmentLineId)

						if (!prevSegLine) {
							// We couldn't find the previous segment line: this is not a critical issue, but is clearly is a symptom of a larger issue
							logger.error(`Previous segment line "${runningOrder.currentSegmentLineId}" on running order "${roId}" could not be found.`)
						} else if (!prevSegLine.duration) {
							setPreviousLinePlaybackDuration(roId, prevSegLine, startedPlayback)
						}
					}

					setRunningOrderStartedPlayback(runningOrder, startedPlayback) // Set startedPlayback on the running order if this is the first item to be played

					let segmentLinesAfter = runningOrder.getSegmentLines({
						_rank: {
							$gt: segLine._rank,
						},
						_id: { $ne: segLine._id }
					})

					let nextSegmentLine: SegmentLine | null = segmentLinesAfter[0] || null

					RunningOrders.update(runningOrder._id, {
						$set: {
							currentSegmentLineId: segLine._id,
							nextSegmentLineId: nextSegmentLine._id
						}
					})

					clearNextLineStartedPlaybackAndDuration(roId, nextSegmentLine._id)
				} else {
					// a segment line is being played that has not been selected for playback by Core
					// show must go on, so find next segmentLine and update the RunningOrder, but log an error
					let segmentLinesAfter = runningOrder.getSegmentLines({
						_rank: {
							$gt: segLine._rank,
						},
						_id: { $ne: segLine._id }
					})

					let nextSegmentLine: SegmentLine | null = segmentLinesAfter[0] || null

					setRunningOrderStartedPlayback(runningOrder, startedPlayback) // Set startedPlayback on the running order if this is the first item to be played

					RunningOrders.update(runningOrder._id, {
						$set: {
							previousSegmentLineId: null,
							currentSegmentLineId: segLine._id,
							nextSegmentLineId: nextSegmentLine._id
						}
					})

					clearNextLineStartedPlaybackAndDuration(roId, nextSegmentLine._id)

					logger.error(`Segment Line "${segLine._id}" has started playback by the TSR, but has not been selected for playback!`)
				}

				SegmentLines.update(segLine._id, {$set: {
					startedPlayback
				}})
				updateTimeline(runningOrder.studioInstallationId, startedPlayback)

				if (segLine.updateStoryStatus) {
					sendStoryStatus(runningOrder, segLine)
				}
			}
		} else {
			throw new Meteor.Error(404, `Segment line "${slId}" in running order "${roId}" not found!`)
		}
	},
	'playout_segmentAdLibLineItemStart': (roId: string, slId: string, slaiId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)
		let segLine = SegmentLines.findOne({
			_id: slId,
			runningOrderId: roId
		})
		if (!segLine) throw new Meteor.Error(404, `Segment Line "${slId}" not found!`)
		let adLibItem = SegmentLineAdLibItems.findOne({
			_id: slaiId,
			runningOrderId: roId
		})
		if (!adLibItem) throw new Meteor.Error(404, `Segment Line Ad Lib Item "${slaiId}" not found!`)
		if (!runningOrder.active) throw new Meteor.Error(403, `Segment Line Ad Lib Items can be only placed in an active running order!`)
		if (runningOrder.currentSegmentLineId !== segLine._id) throw new Meteor.Error(403, `Segment Line Ad Lib Items can be only placed in a current segment line!`)

		let newSegmentLineItem = convertAdLibToSLineItem(adLibItem, segLine)
		SegmentLineItems.insert(newSegmentLineItem)

		// logger.debug('adLibItemStart', newSegmentLineItem)

		stopInfinitesRunningOnLayer(runningOrder, segLine, newSegmentLineItem.sourceLayerId)

		updateTimeline(runningOrder.studioInstallationId)
	},
	'playout_runningOrderBaselineAdLibItemStart': (roId: string, slId: string, robaliId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)
		let segLine = SegmentLines.findOne({
			_id: slId,
			runningOrderId: roId
		})
		if (!segLine) throw new Meteor.Error(404, `Segment Line "${slId}" not found!`)
		let adLibItem = RunningOrderBaselineAdLibItems.findOne({
			_id: robaliId,
			runningOrderId: roId
		})
		if (!adLibItem) throw new Meteor.Error(404, `Running Order Baseline Ad Lib Item "${robaliId}" not found!`)
		if (!runningOrder.active) throw new Meteor.Error(403, `Running Order Baseline Ad Lib Items can be only placed in an active running order!`)
		if (runningOrder.currentSegmentLineId !== segLine._id) throw new Meteor.Error(403, `Running Order Baseline Ad Lib Items can be only placed in a current segment line!`)

		let newSegmentLineItem = convertAdLibToSLineItem(adLibItem, segLine)
		SegmentLineItems.insert(newSegmentLineItem)

		// logger.debug('adLibItemStart', newSegmentLineItem)

		stopInfinitesRunningOnLayer(runningOrder, segLine, newSegmentLineItem.sourceLayerId)

		updateTimeline(runningOrder.studioInstallationId)
	},
	'playout_segmentAdLibLineItemStop': (roId: string, slId: string, sliId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)
		let segLine = SegmentLines.findOne({
			_id: slId,
			runningOrderId: roId
		})
		if (!segLine) throw new Meteor.Error(404, `Segment Line "${slId}" not found!`)
		let alCopyItem = SegmentLineItems.findOne({
			_id: sliId,
			runningOrderId: roId
		})
		// To establish playback time, we need to look at the actual Timeline
		let alCopyItemTObj = Timeline.findOne({
			_id: PlayoutTimelinePrefixes.SEGMENT_LINE_ITEM_GROUP_PREFIX + sliId
		})
		let parentOffset = 0
		if (!alCopyItem) throw new Meteor.Error(404, `Segment Line Ad Lib Copy Item "${sliId}" not found!`)
		if (!alCopyItemTObj) throw new Meteor.Error(404, `Segment Line Ad Lib Copy Item "${sliId}" not found in the playout Timeline!`)
		if (!runningOrder.active) throw new Meteor.Error(403, `Segment Line Ad Lib Copy Items can be only manipulated in an active running order!`)
		if (runningOrder.currentSegmentLineId !== segLine._id) throw new Meteor.Error(403, `Segment Line Ad Lib Copy Items can be only manipulated in a current segment line!`)
		if (!alCopyItem.dynamicallyInserted) throw new Meteor.Error(501, `"${sliId}" does not appear to be a dynamic Segment Line Item!`)
		if (!alCopyItem.adLibSourceId) throw new Meteor.Error(501, `"${sliId}" does not appear to be a Segment Line Ad Lib Copy Item!`)

		// The ad-lib item positioning will be relative to the startedPlayback of the segment line
		if (segLine.startedPlayback) {
			parentOffset = segLine.startedPlayback
		}

		let newExpectedDuration = 1 // smallest, non-zero duration
		if (alCopyItemTObj.trigger.type === TriggerType.TIME_ABSOLUTE && _.isNumber(alCopyItemTObj.trigger.value)) {
			const actualStartTime = parentOffset + alCopyItemTObj.trigger.value
			newExpectedDuration = getCurrentTime() - actualStartTime
		} else {
			logger.warn(`"${sliId}" timeline object is not positioned absolutely or is still set to play now, assuming it's about to be played.`)
		}

		SegmentLineItems.update({
			_id: sliId,
		}, {$set: {
			duration: newExpectedDuration
		}})

		updateTimeline(runningOrder.studioInstallationId)
	},
	'playout_sourceLayerOnLineStop': (roId: string, slId: string, sourceLayerId: string) => {
		let runningOrder = RunningOrders.findOne(roId)
		if (!runningOrder) throw new Meteor.Error(404, `RunningOrder "${roId}" not found!`)
		let segLine = SegmentLines.findOne({
			_id: slId,
			runningOrderId: roId
		})
		if (!segLine) throw new Meteor.Error(404, `Segment Line "${slId}" not found!`)
		let slItems = SegmentLineItems.find({
			runningOrderId: roId,
			segmentLineId: slId,
			sourceLayerId: sourceLayerId
		}).fetch()
		if (!runningOrder.active) throw new Meteor.Error(403, `Segment Line Items can be only manipulated in an active running order!`)
		if (runningOrder.currentSegmentLineId !== segLine._id) throw new Meteor.Error(403, `Segment Line Items can be only manipulated in a current segment line!`)

		let parentOffset = 0
		if (segLine.startedPlayback) {
			parentOffset = segLine.startedPlayback
		}

		const now = getCurrentTime()
		slItems.forEach((item) => {
			let newExpectedDuration = 1 // smallest, non-zero duration
			if (item.trigger.type === TriggerType.TIME_ABSOLUTE && _.isNumber(item.trigger.value)) {
				const actualStartTime = parentOffset + item.trigger.value
				newExpectedDuration = now - actualStartTime
			} else {
				logger.warn(`"${item._id}" timeline object is not positioned absolutely or is still set to play now, assuming it's about to be played.`)
			}

			// Only update if the new duration is shorter than the old one, since we are supposed to cut stuff short
			if ((newExpectedDuration < item.expectedDuration) || (item.expectedDuration === 0)) {
				SegmentLineItems.update({
					_id: item._id
				}, {$set: {
					duration: newExpectedDuration
				}})
			}
		})

		updateSourceLayerInfinitesAfterLine(runningOrder, false, segLine)

		updateTimeline(runningOrder.studioInstallationId)
	},
	'playout_timelineTriggerTimeUpdate': (timelineObjId: string, time: number) => {
		let tObj = Timeline.findOne(timelineObjId)
		if (!tObj) throw new Meteor.Error(404, `Timeline obj "${timelineObjId}" not found!`)

		if (tObj.metadata && tObj.metadata.segmentLineItemId) {
			logger.debug('Update segment line item: ', tObj.metadata.segmentLineItemId, (new Date(time)).toTimeString())
			SegmentLineItems.update({
				_id: tObj.metadata.segmentLineItemId
			}, {$set: {
				trigger: {
					type: TriggerType.TIME_ABSOLUTE,
					value: time
				}
			}})
		}
	}
})

// TODO - execute this after importing rundown
function updateSourceLayerInfinitesAfterLine (runningOrder: RunningOrder, runUntilEnd: boolean, previousLine?: SegmentLine) {
	let activeLines: { [layer: string]: SegmentLineItem } = {}
	let activeLinesSegments: { [layer: string]: string } = {}

	if (previousLine) {
		// figure out the baseline to set
		let prevItems = previousLine.getSegmentLinesItems().filter(i => i.infiniteMode)
		for (let item of prevItems) {
			// this means it has been stopped, so dont continue it now
			if (item.duration) {
				continue
			}

			if (!item.infiniteId) {
				// ensure infinite id is set
				item.infiniteId = item._id
				SegmentLineItems.update(item._id, { $set: { infiniteId: item.infiniteId } })
			}

			activeLines[item.sourceLayerId] = item
			activeLinesSegments[item.sourceLayerId] = previousLine.segmentId
		}
	}

	let linesToProcess = runningOrder.getSegmentLines()
	if (previousLine) {
		linesToProcess = linesToProcess.filter(l => l._rank > previousLine._rank)
	}

	for (let line of linesToProcess) {
		// Drop any that relate only to previous segments
		for (let k in activeLinesSegments) {
			let s = activeLinesSegments[k]
			let i = activeLines[k]
			if (!i.infiniteMode || i.infiniteMode === SegmentLineItemLifespan.OutOnNext && s !== line.segmentId) {
				delete activeLines[k]
				delete activeLinesSegments[k]
			}
		}

		// ensure any currently defined infinites are still wanted
		let currentItems = line.getSegmentLinesItems()
		let currentInfinites = currentItems.filter(i => i.infiniteMode && i.infiniteId && i.infiniteId !== i._id)
		let removedInfinites: string[] = []
		for (let item of currentInfinites) {
			if (!activeLinesSegments[item.sourceLayerId]) {
				// Previous item no longer enforces the existence of this one
				SegmentLineItems.remove(item)
				removedInfinites.push(item._id)
			}
			// TODO - should i check whether it has ended, as that could have happened if we are reevaluating??
		}

		// stop if not running to the end and there is/was nothing active
		if (!runUntilEnd && Object.keys(activeLinesSegments).length === 0 && currentInfinites.length === 0) {
			break
		}

		// figure out what infinites are to be extended
		// TODO - these need sorting somehow so that we go through them sequentially. or at least sequentially within layers
		currentItems = currentItems.filter(i => removedInfinites.indexOf(i._id) < 0)
		for (let k in activeLines) {
			let newItem = activeLines[k]

			const exist = currentItems.filter(i => i.sourceLayerId === newItem.sourceLayerId)
			if (exist && exist.length > 0) {
				if (exist.find(e => !!e.infiniteId && e.infiniteId === newItem.infiniteId)) {
					continue
				}

				delete activeLines[k] // It will be stopped by this line
				delete activeLinesSegments[k] // It will be stopped by this line

				// if we matched with an infinite, then make sure that infinite is kept going
				if (exist[0].infiniteMode) {
					activeLines[k] = exist[0]
					activeLinesSegments[k] = line.segmentId
				}

				// Timings get handled when the replacement item starts playing.
				// itll be too complicated to try and calculate in advance and it wouldnt account for any runtime latencies etc
				if (exist[0].trigger.type === TriggerType.TIME_ABSOLUTE) {
					if (exist[0].trigger.value === 0) {
						// skip the infinite, as it will never show
						continue
					}
				}
			}

			newItem.segmentLineId = line._id
			newItem.continuesRefId = newItem._id
			newItem.trigger = {
				type: TriggerType.TIME_ABSOLUTE,
				value: 0
			}
			newItem._id = newItem.infiniteId + '_' + line._id

			SegmentLineItems.insert(newItem)
		}

		// find any new infinites exposed by this
		let newInfinites = currentItems.filter(i => i.infiniteMode && (!i.infiniteId || i.infiniteId === i._id))
		newInfinites.forEach(i => {
			// Set the infinite id of this
			if (!i.infiniteId) {
				i.infiniteId = i._id
				SegmentLineItems.update(i._id, {$set: {
					infiniteId: i._id
				}})
			}

			// can only be one infinite on a layer at a time
			// TODO - if there are multiple in this set, make sure to pass on the last one
			activeLines[i.sourceLayerId] = i
			activeLinesSegments[i.sourceLayerId] = line.segmentId
		})
	}
}

function stopInfinitesRunningOnLayer (runningOrder: RunningOrder, segLine: SegmentLine, sourceLayer: string) {
	let remainingLines = runningOrder.getSegmentLines().filter(l => l._rank > segLine._rank)
	for (let line of remainingLines) {
		let continuations = line.getSegmentLinesItems().filter(i => i.infiniteMode && i.infiniteId && i.infiniteId !== i._id && i.sourceLayerId === sourceLayer)
		if (continuations.length === 0) {
			break
		}

		continuations.forEach(i => SegmentLineItems.remove(i))
	}

	// ensure adlib is extended correctly if infinite
	updateSourceLayerInfinitesAfterLine(runningOrder, false, segLine)
}

function convertAdLibToSLineItem (adLibItem: SegmentLineAdLibItem, segmentLine: SegmentLine): SegmentLineItem {
	const oldId = adLibItem._id
	const newId = Random.id()
	const newSLineItem = literal<SegmentLineItem>(_.extend(
		adLibItem,
		{
			_id: newId,
			trigger: {
				type: TriggerType.TIME_ABSOLUTE,
				value: 'now'
			},
			segmentLineId: segmentLine._id,
			adLibSourceId: adLibItem._id,
			dynamicallyInserted: true,
			expectedDuration: adLibItem.expectedDuration || 0 // set duration to infinite if not set by AdLibItem
		}
	))

	if (newSLineItem.content && newSLineItem.content.timelineObjects) {
		let contentObjects = newSLineItem.content.timelineObjects
		newSLineItem.content.timelineObjects = _.compact(contentObjects).map(
			(item) => {
				const itemCpy = _.extend(item, {
					_id: newId + '_' + item!._id,
					id: newId + '_' + item!._id
				})
				return itemCpy as TimelineObj
			}
		)
	}
	return newSLineItem
}

function setRunningOrderStartedPlayback (runningOrder, startedPlayback) {
	if (!runningOrder.startedPlayback) { // Set startedPlayback on the running order if this is the first item to be played
		RunningOrders.update(runningOrder._id, {
			$set: {
				startedPlayback
			}
		})
	}
}

function setPreviousLinePlaybackDuration (roId: string, prevSegLine: SegmentLine, lastChange: Time) {
	if (prevSegLine.startedPlayback && prevSegLine.startedPlayback > 0) {
		SegmentLines.update(prevSegLine._id, {
			$set: {
				duration: lastChange - prevSegLine.startedPlayback
			}
		})
	} else {
		logger.error(`Previous segment line "${prevSegLine._id}" has never started playback on running order "${roId}".`)
	}
}

function clearNextLineStartedPlaybackAndDuration (roId: string, nextSlId: string) {
	SegmentLines.update(nextSlId, {
		$unset: {
			duration: 0,
			startedPlayback: 0
		}
	})
	SegmentLineItems.update({segmentLineId: nextSlId}, {
		$unset: {
			startedPlayback: 0
		}
	})
}

function createSegmentLineGroup (segmentLine: SegmentLine, duration: Time): TimelineObj {
	let slGrp = literal<TimelineObjGroupSegmentLine>({
		_id: PlayoutTimelinePrefixes.SEGMENT_LINE_GROUP_PREFIX + segmentLine._id,
		siId: '', // added later
		roId: '', // added later
		deviceId: [],
		trigger: {
			type: TriggerType.TIME_ABSOLUTE,
			value: 'now'
		},
		duration: duration,
		LLayer: 'core_abstract',
		content: {
			type: TimelineContentTypeOther.GROUP,
			objects: []
		},
		isGroup: true,
		isSegmentLineGroup: true,
		// slId: segmentLine._id
	})

	return slGrp
}
function createSegmentLineGroupFirstObject (segmentLine: SegmentLine, segmentLineGroup: TimelineObj): TimelineObj {
	return literal<TimelineObjAbstract>({
		_id: PlayoutTimelinePrefixes.SEGMENT_LINE_GROUP_FIRST_ITEM_PREFIX + segmentLine._id,
		siId: '', // added later
		roId: '', // added later
		deviceId: [],
		trigger: {
			type: TriggerType.TIME_ABSOLUTE,
			value: 0
		},
		duration: 0,
		LLayer: 'core_abstract',
		content: {
			type: TimelineContentTypeOther.NOTHING,
		},
		// isGroup: true,
		inGroup: segmentLineGroup._id,
		slId: segmentLine._id
	})
}
function createSegmentLineItemGroupFirstObject (segmentLineItem: SegmentLineItem, segmentLineItemGroup: TimelineObj): TimelineObj {
	return literal<TimelineObjAbstract2>({
		_id: PlayoutTimelinePrefixes.SEGMENT_LINE_ITEM_GROUP_FIRST_ITEM_PREFIX + segmentLineItem._id,
		siId: '', // added later
		roId: '', // added later
		deviceId: [],
		trigger: {
			type: TriggerType.TIME_ABSOLUTE,
			value: 0
		},
		duration: 0,
		LLayer: segmentLineItem.sourceLayerId + '_2', // TODO - needs its own unique llayer...
		content: {
			type: TimelineContentTypeOther.NOTHING,
		},
		// isGroup: true,
		inGroup: segmentLineItemGroup._id,
		sliId: segmentLineItem._id,
	})
}

function createSegmentLineItemGroup (item: SegmentLineItem | RunningOrderBaselineItem, duration: number, segmentLineGroup?: TimelineObj): TimelineObj {
	return literal<TimelineObjGroup>({
		_id: PlayoutTimelinePrefixes.SEGMENT_LINE_ITEM_GROUP_PREFIX + item._id,
		content: {
			type: TimelineContentTypeOther.GROUP,
			objects: []
		},
		inGroup: segmentLineGroup && segmentLineGroup._id,
		isGroup: true,
		siId: '',
		roId: '',
		deviceId: [],
		trigger: item.trigger,
		duration: duration,
		LLayer: item.sourceLayerId,
		metadata: {
			segmentLineItemId: item._id
		}
	})
}

function transformBaselineItemsIntoTimeline (items: RunningOrderBaselineItem[]): Array<TimelineObj> {
	let timelineObjs: Array<TimelineObj> = []
	_.each(items, (item: RunningOrderBaselineItem) => {
		if (
			item.content &&
			item.content.timelineObjects
		) {
			let tos = item.content.timelineObjects

			// the baseline items are layed out without any grouping
			_.each(tos, (o: TimelineObj) => {
				// do some transforms maybe?
				timelineObjs.push(o)
			})
		}
	})
	return timelineObjs
}

function transformSegmentLineIntoTimeline (items: SegmentLineItem[], segmentLineGroup?: TimelineObj, allowTransition?: boolean): Array<TimelineObj> {
	let timelineObjs: Array<TimelineObj> = []

	_.each(items, (item: SegmentLineItem) => {
		if (!allowTransition && item.isTransition) {
			return
		}

		if (
			item.content &&
			item.content.timelineObjects
		) {
			let tos = item.content.timelineObjects

			// create a segmentLineItem group for the items and then place all of them there
			let lineItemDuration = item.duration || item.expectedDuration || 0
			const segmentLineItemGroup = createSegmentLineItemGroup(item, lineItemDuration, segmentLineGroup)
			timelineObjs.push(segmentLineItemGroup)
			timelineObjs.push(createSegmentLineItemGroupFirstObject(item, segmentLineItemGroup))

			_.each(tos, (o: TimelineObj) => {
				if (segmentLineGroup) {
					o.inGroup = segmentLineItemGroup._id
					if (o.duration > lineItemDuration && lineItemDuration !== 0) {
						lineItemDuration = o.duration
					}
				}

				timelineObjs.push(o)
			})

			segmentLineItemGroup.duration = lineItemDuration
		}
	})
	return timelineObjs
}

/**
 * Updates the Timeline to reflect the state in the RunningOrder, Segments, Segmentlines etc...
 * @param studioInstallationId id of the studioInstallation to update
 * @param forceNowToTime if set, instantly forces all "now"-objects to that time (used in autoNext)
 */
function updateTimeline (studioInstallationId: string, forceNowToTime?: Time) {
	const activeRunningOrder = RunningOrders.findOne({
		studioInstallationId: studioInstallationId,
		active: true
	})

	if (activeRunningOrder) {
		let studioInstallation = activeRunningOrder.getStudioInstallation()

		// remove anything not related to active running order:
		Timeline.remove({
			siId: studioInstallationId,
			roId: {
				$not: {
					$eq: activeRunningOrder._id
				}
			}
		})
		// Todo: Add default objects:
		let timelineObjs: Array<TimelineObj> = []

		// Generate timeline: -------------------------------------------------

		// Default timelineobjects

		logger.debug('Timeline update!')

		const baselineItems = RunningOrderBaselineItems.find({
			runningOrderId: activeRunningOrder._id
		}).fetch()

		if (baselineItems) {
			timelineObjs = timelineObjs.concat(transformBaselineItemsIntoTimeline(baselineItems))
		}

		// Currently playing

		let currentSegmentLine: SegmentLine | undefined
		let nextSegmentLine: SegmentLine | undefined
		let currentSegmentLineGroup: TimelineObj | undefined
		let previousSegmentLineGroup: TimelineObj | undefined

		// we get the nextSegmentLine first, because that affects how the currentSegmentLine will be treated
		if (activeRunningOrder.nextSegmentLineId) {
			// We may be at the beginning of a show, and there can be no currentSegmentLine and we are waiting for the user to Take
			nextSegmentLine = SegmentLines.findOne(activeRunningOrder.nextSegmentLineId)
			if (!nextSegmentLine) throw new Meteor.Error(404, `SegmentLine "${activeRunningOrder.nextSegmentLineId}" not found!`)
		}

		if (activeRunningOrder.currentSegmentLineId) {
			currentSegmentLine = SegmentLines.findOne(activeRunningOrder.currentSegmentLineId)
			if (!currentSegmentLine) throw new Meteor.Error(404, `SegmentLine "${activeRunningOrder.currentSegmentLineId}" not found!`)
			const currentSegmentLineItems = currentSegmentLine.getSegmentLinesItems()
			const currentInfiniteItems = currentSegmentLineItems.filter(l => (l.infiniteMode && l.infiniteId && l.infiniteId !== l._id))
			const currentNormalItems = currentSegmentLineItems.filter(l => !(l.infiniteMode && l.infiniteId && l.infiniteId !== l._id))
			// @todo verify this condition logic

			let allowTransition = false

			let previousSegmentLine: SegmentLine | undefined
			if (activeRunningOrder.previousSegmentLineId) {
				previousSegmentLine = SegmentLines.findOne(activeRunningOrder.previousSegmentLineId)
				if (!previousSegmentLine) throw new Meteor.Error(404, `SegmentLine "${activeRunningOrder.previousSegmentLineId}" not found!`)

				allowTransition = !previousSegmentLine.disableOutTransition

				if (previousSegmentLine.startedPlayback && !previousSegmentLine.disableOutTransition) {
					const duration = (currentSegmentLine.startedPlayback || getCurrentTime()) - previousSegmentLine.startedPlayback
					if (duration > 0) {
						const transition = currentSegmentLine.getSegmentLinesItems().find((sl: SegmentLineItem) => sl.isTransition)
						previousSegmentLineGroup = createSegmentLineGroup(previousSegmentLine, duration + Math.max(transition ? transition.expectedDuration || 0 : 0, currentSegmentLine.overlapDuration || 0))
						previousSegmentLineGroup.priority = -1
						previousSegmentLineGroup.trigger = literal<ITimelineTrigger>({
							type: TriggerType.TIME_ABSOLUTE,
							value: previousSegmentLine.startedPlayback
						})

						// If a SegmentLineItem is infinite, and continued in the new SegmentLine, then we want to add the SegmentLineItem only there to avoid id collisions
						const skipIds = currentInfiniteItems.map(l => l.infiniteId || '')
						const previousSegmentLineItems = previousSegmentLine.getSegmentLinesItems().filter(l => !l.infiniteId || skipIds.indexOf(l.infiniteId) < 0)

						timelineObjs = timelineObjs.concat(
							previousSegmentLineGroup,
							transformSegmentLineIntoTimeline(previousSegmentLineItems, previousSegmentLineGroup, false))
						timelineObjs.push(createSegmentLineGroupFirstObject(previousSegmentLine, previousSegmentLineGroup))
					}
				}
			}

			// fetch items
			// fetch the timelineobjs in items
			const isFollowed = nextSegmentLine && currentSegmentLine.autoNext
			currentSegmentLineGroup = createSegmentLineGroup(currentSegmentLine, (isFollowed ? (currentSegmentLine.expectedDuration || 0) : 0))
			if (currentSegmentLine.startedPlayback) { // If we are recalculating the currentLine, then ensure it doesnt think it is starting now
				currentSegmentLineGroup.trigger = literal<ITimelineTrigger>({
					type: TriggerType.TIME_ABSOLUTE,
					value: currentSegmentLine.startedPlayback
				})
			}

			// any continued infinite lines need to skip the group, as they need a different start trigger
			for (let item of currentInfiniteItems) {
				const infiniteGroup = createSegmentLineGroup(currentSegmentLine, 0)
				infiniteGroup._id = PlayoutTimelinePrefixes.SEGMENT_LINE_GROUP_PREFIX + item._id + '_infinite'

				if (item.infiniteId) {
					let originalItem = SegmentLineItems.findOne(item.infiniteId)

					if (originalItem && originalItem.startedPlayback) {
						infiniteGroup.trigger = literal<ITimelineTrigger>({
							type: TriggerType.TIME_ABSOLUTE,
							value: originalItem.startedPlayback
						})
					}
				}

				const objs = transformSegmentLineIntoTimeline([item], infiniteGroup, false)
				// @todo this is a hack that hopefully will not be needed once the duration of the infinite item is back to 0
				if (objs[0].duration !== 0 && item.duration) {
					objs[0].duration = item.duration || 0
				}

				timelineObjs = timelineObjs.concat(infiniteGroup, objs)
			}

			// @todo any infinite items that originate on this segment do not get stopped properly currently. because they are missing the duration hack as shown above, so this may not need any attention

			timelineObjs = timelineObjs.concat(currentSegmentLineGroup, transformSegmentLineIntoTimeline(currentNormalItems, currentSegmentLineGroup, allowTransition))

			timelineObjs.push(createSegmentLineGroupFirstObject(currentSegmentLine, currentSegmentLineGroup))
		}

		// only add the next objects into the timeline if the next segment is autoNext
		if (nextSegmentLine && currentSegmentLine && currentSegmentLine.autoNext) {
			let nextSegmentLineGroup = createSegmentLineGroup(nextSegmentLine, 0)
			if (currentSegmentLineGroup) {
				nextSegmentLineGroup.trigger = literal<ITimelineTrigger>({
					type: TriggerType.TIME_RELATIVE,
					value: `#${currentSegmentLineGroup._id}.end - ${nextSegmentLine.overlapDuration || 0}`
				})
			}
			timelineObjs = timelineObjs.concat(
				nextSegmentLineGroup,
				transformSegmentLineIntoTimeline(nextSegmentLine.getSegmentLinesItems(), nextSegmentLineGroup, currentSegmentLine && !currentSegmentLine.disableOutTransition))
			timelineObjs.push(createSegmentLineGroupFirstObject(nextSegmentLine, nextSegmentLineGroup))
		}

		if (!activeRunningOrder.nextSegmentLineId && !activeRunningOrder.currentSegmentLineId) {
			// maybe at the end of the show
			logger.info(`No next segmentLine and no current segment line set on running order "${activeRunningOrder._id}".`)
		}

		// next (on pvw (or on pgm if first))

		// Pre-process the timelineObjects:

		// create a mapping of which playout parent processes that has which playoutdevices:
		let deviceParentDevice: {[deviceId: string]: PeripheralDevice} = {}
		let peripheralDevicesInStudio = PeripheralDevices.find({
			studioInstallationId: studioInstallation._id,
			type: PeripheralDeviceAPI.DeviceType.PLAYOUT
		}).fetch()
		_.each(peripheralDevicesInStudio, (pd) => {
			if (pd.settings) {
				let settings = pd.settings as PlayoutDeviceSettings
				_.each(settings.devices, (device, deviceId) => {
					deviceParentDevice[deviceId] = pd
				})
			}
		})

		// first, split out any grouped objects, to make the timeline shallow:
		let fixObjectChildren = (o: TimelineObjGroup) => {
			if (o.isGroup && o.content && o.content.objects && o.content.objects.length) {
				// let o2 = o as TimelineObjGroup
				_.each(o.content.objects, (child) => {
					let childFixed: TimelineObj = _.extend(child, {
						inGroup: o._id,
						_id: child.id || child['_id']
					})
					delete childFixed['id']
					timelineObjs.push(childFixed)
					fixObjectChildren(childFixed as TimelineObjGroup)
				})
				delete o.content.objects
			}
		}
		_.each(timelineObjs, (o: TimelineObj) => {
			fixObjectChildren(o as TimelineObjGroup)
		})
		// Add deviceIds to all children objects
		let groupDeviceIds: {[groupId: string]: Array<string>} = {}
		_.each(timelineObjs, (o) => {
			o.roId = activeRunningOrder._id
			o.siId = studioInstallation._id
			if (!o.isGroup) {
				const layerId = o.LLayer + ''
				let LLayerMapping = (studioInstallation.mappings || {})[layerId]

				if (!LLayerMapping) { // @todo this block properly
					let targetId = layerId.substr(0, layerId.length - 2)
					let sourceLayer = (studioInstallation.sourceLayers || []).find(l => l._id === targetId)
					if (sourceLayer) {
						LLayerMapping = (studioInstallation.mappings || {})['core_abstract']
					}
				}

				if (LLayerMapping) {
					let parentDevice = deviceParentDevice[LLayerMapping.deviceId]
					if (!parentDevice) throw new Meteor.Error(404, 'No parent-device found for device "' + LLayerMapping.deviceId + '"')

					o.deviceId = [parentDevice._id]

					if (o.inGroup) {
						if (!groupDeviceIds[o.inGroup]) groupDeviceIds[o.inGroup] = []
						groupDeviceIds[o.inGroup].push(parentDevice._id)
					}

				} else logger.warn('TimelineObject "' + o._id + '" has an unknown LLayer: "' + o.LLayer + '"')
			}
		})
		let groupObjs = _.compact(_.map(timelineObjs, (o) => {
			if (o.isGroup) {
				return o
			}
			return null
		}))

		// add the children's deviceIds to their parent groups:
		let shouldNotRunAgain = true
		let shouldRunAgain = true
		for (let i = 0; i < 10; i++) {
			shouldNotRunAgain = true
			shouldRunAgain = false
			_.each(groupObjs, (o) => {
				if (o.inGroup) {
					if (!groupDeviceIds[o.inGroup]) groupDeviceIds[o.inGroup] = []
					groupDeviceIds[o.inGroup] = groupDeviceIds[o.inGroup].concat(o.deviceId)
					shouldNotRunAgain = false
				}
				if (o.isGroup) {
					let newDeviceId = _.uniq(groupDeviceIds[o._id] || [], false)

					if (!_.isEqual(o.deviceId, newDeviceId)) {
						shouldRunAgain = true
						o.deviceId = newDeviceId
					}
				}
			})
			if (!shouldRunAgain && shouldNotRunAgain) break
		}

		const missingDev = groupObjs.filter(o => !o.deviceId || !o.deviceId[0]).map(o => o._id)
		if (missingDev.length > 0) {
			logger.warn('Found groups without any deviceId: ' + missingDev)
		}

		// logger.debug('timelineObjs', timelineObjs)

		if (forceNowToTime) { // used when autoNexting
			setNowToTimeInObjects(timelineObjs, forceNowToTime)
		}

		setLawoObjectsTriggerValue(timelineObjs, currentSegmentLine)

		saveIntoDb<TimelineObj, TimelineObj>(Timeline, {
			roId: activeRunningOrder._id
		}, timelineObjs, {
			beforeUpdate: (o: TimelineObj, oldO: TimelineObj): TimelineObj => {
				// do not overwrite trigger when the trigger has been denowified
				if (o.trigger.value === 'now' && oldO.trigger.setFromNow) {
					o.trigger.type = oldO.trigger.type
					o.trigger.value = oldO.trigger.value
				}
				return o
			}
		})
	} else {
		// remove everything:
		Timeline.remove({
			siId: studioInstallationId
		})
	}
}
/**
 * goes through timelineObjs and forces the "now"-values to the absolute time specified
 * @param timelineObjs Array of (flat) timeline objects
 * @param now The time to set the "now":s to
 */
function setNowToTimeInObjects (timelineObjs: Array<TimelineObj>, now: Time): void {
	_.each(timelineObjs, (o) => {
		if (o.trigger.type === TriggerType.TIME_ABSOLUTE &&
			o.trigger.value === 'now'
		) {
			o.trigger.value = now
			o.trigger.setFromNow = true
		}
	})
}

function setLawoObjectsTriggerValue (timelineObjs: Array<TimelineObj>, currentSegmentLine: SegmentLine | undefined) {

	_.each(timelineObjs, (obj) => {
		if (obj.content.type === TimelineContentTypeLawo.SOURCE ) {
			let lawoObj = obj as TimelineObjLawo

			_.each(lawoObj.content.attributes, (val, key) => {
				// set triggerValue to the current playing segment, thus triggering commands to be sent when nexting:
				lawoObj.content.attributes[key].triggerValue = (currentSegmentLine || {_id: ''})._id
			})
		}
	})
}
