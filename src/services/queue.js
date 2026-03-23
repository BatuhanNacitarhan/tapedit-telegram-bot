/**
 * Kuyruk Sistemi - Queue Service
 */

class QueueService {
  constructor() {
    this.queue = [];
    this.processing = new Map();
    this.maxConcurrent = 1;
    this.averageProcessTime = 45;
    this.completedCount = 0;
  }
  
  enqueue(userId, data = {}) {
    const existingIndex = this.queue.findIndex(item => item.userId === userId);
    if (existingIndex !== -1) {
      return {
        success: false,
        position: existingIndex + 1,
        message: 'already_in_queue',
        estimatedWait: this._calculateEstimatedWait(existingIndex)
      };
    }
    
    if (this.processing.has(userId)) {
      return {
        success: false,
        position: 0,
        message: 'already_processing',
        estimatedWait: 0
      };
    }
    
    const queueItem = {
      userId,
      data,
      enqueuedAt: Date.now(),
      id: `${userId}_${Date.now()}`
    };
    
    this.queue.push(queueItem);
    const position = this.queue.length;
    
    console.log(`📥 Kuyruk: +${userId} | Pozisyon: ${position}`);
    
    return {
      success: true,
      position,
      message: 'added_to_queue',
      estimatedWait: this._calculateEstimatedWait(position - 1),
      queueId: queueItem.id
    };
  }
  
  dequeue() {
    if (this.queue.length === 0) return null;
    if (this.processing.size >= this.maxConcurrent) return null;
    
    const item = this.queue.shift();
    item.startedAt = Date.now();
    this.processing.set(item.userId, item);
    
    return item;
  }
  
  complete(userId, success = true) {
    const item = this.processing.get(userId);
    if (item) {
      const processTime = (Date.now() - item.startedAt) / 1000;
      this.averageProcessTime = (this.averageProcessTime * 0.9) + (processTime * 0.1);
      this.processing.delete(userId);
      this.completedCount++;
    }
  }
  
  cancel(userId) {
    const index = this.queue.findIndex(item => item.userId === userId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      return true;
    }
    if (this.processing.has(userId)) {
      this.processing.delete(userId);
      return true;
    }
    return false;
  }
  
  getStatus(userId) {
    if (this.processing.has(userId)) {
      const item = this.processing.get(userId);
      const elapsed = (Date.now() - item.startedAt) / 1000;
      return { status: 'processing', position: 0, elapsed, message: 'processing_now' };
    }
    
    const position = this.queue.findIndex(item => item.userId === userId);
    if (position !== -1) {
      const waitTime = (Date.now() - this.queue[position].enqueuedAt) / 1000;
      return {
        status: 'queued',
        position: position + 1,
        waitTime,
        estimatedWait: this._calculateEstimatedWait(position),
        totalInQueue: this.queue.length,
        message: 'in_queue'
      };
    }
    
    return { status: 'not_in_queue', position: 0, message: 'not_in_queue' };
  }
  
  _calculateEstimatedWait(positionIndex) {
    const processingCount = this.processing.size;
    return Math.ceil((positionIndex + processingCount) * this.averageProcessTime);
  }
  
  getStats() {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      maxConcurrent: this.maxConcurrent,
      averageProcessTime: Math.round(this.averageProcessTime),
      completedCount: this.completedCount
    };
  }
}

// Class'ı ve instance'ı birlikte export et
const queueServiceInstance = new QueueService();

module.exports = queueServiceInstance;
module.exports.QueueService = QueueService;
