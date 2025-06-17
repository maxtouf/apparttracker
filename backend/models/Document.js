const mongoose = require('mongoose');
const path = require('path');

const documentSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Propriété requise']
  },
  step: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Step'
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Utilisateur requis']
  },
  name: {
    type: String,
    required: [true, 'Nom du document requis'],
    trim: true,
    maxlength: [200, 'Le nom ne peut pas dépasser 200 caractères']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'La description ne peut pas dépasser 500 caractères']
  },
  category: {
    type: String,
    enum: [
      'contrat',
      'diagnostic',
      'facture',
      'photo',
      'plan',
      'compromis',
      'acte_vente',
      'pret',
      'assurance',
      'expertise',
      'correspondance',
      'autre'
    ],
    required: [true, 'Catégorie requise']
  },
  type: {
    type: String,
    enum: [
      'pdf',
      'image',
      'document',
      'spreadsheet',
      'presentation',
      'video',
      'audio',
      'archive',
      'autre'
    ],
    required: [true, 'Type requis']
  },
  file: {
    originalName: {
      type: String,
      required: [true, 'Nom original requis']
    },
    filename: {
      type: String,
      required: [true, 'Nom de fichier requis']
    },
    path: {
      type: String,
      required: [true, 'Chemin requis']
    },
    size: {
      type: Number,
      required: [true, 'Taille requise'],
      min: [0, 'La taille doit être positive']
    },
    mimeType: {
      type: String,
      required: [true, 'Type MIME requis']
    },
    encoding: {
      type: String
    },
    checksum: {
      type: String
    }
  },
  metadata: {
    version: {
      type: String,
      default: '1.0'
    },
    author: {
      type: String,
      trim: true
    },
    subject: {
      type: String,
      trim: true
    },
    keywords: [{
      type: String,
      trim: true
    }],
    createdDate: {
      type: Date
    },
    modifiedDate: {
      type: Date
    },
    pageCount: {
      type: Number,
      min: [0, 'Le nombre de pages doit être positif']
    },
    dimensions: {
      width: Number,
      height: Number
    },
    duration: {
      type: Number,
      min: [0, 'La durée doit être positive']
    }
  },
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'processed', 'error', 'archived'],
    default: 'uploaded'
  },
  visibility: {
    type: String,
    enum: ['private', 'shared', 'public'],
    default: 'private'
  },
  sharedWith: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    permissions: {
      type: String,
      enum: ['view', 'download', 'edit'],
      default: 'view'
    },
    sharedAt: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  expirationDate: {
    type: Date
  },
  isImportant: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  downloadCount: {
    type: Number,
    default: 0,
    min: [0, 'Le nombre de téléchargements doit être positif']
  },
  lastDownloaded: {
    type: Date
  },
  lastDownloadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  versions: [{
    version: {
      type: String,
      required: true
    },
    filename: {
      type: String,
      required: true
    },
    path: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    changelog: {
      type: String,
      trim: true
    }
  }],
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Les notes ne peuvent pas dépasser 1000 caractères']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index pour améliorer les performances
documentSchema.index({ property: 1, createdAt: -1 });
documentSchema.index({ uploadedBy: 1 });
documentSchema.index({ category: 1 });
documentSchema.index({ type: 1 });
documentSchema.index({ status: 1 });
documentSchema.index({ tags: 1 });
documentSchema.index({ isImportant: 1 });
documentSchema.index({ expirationDate: 1 });

// Virtual pour la taille formatée
documentSchema.virtual('formattedSize').get(function() {
  const bytes = this.file.size;
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Virtual pour l'extension du fichier
documentSchema.virtual('fileExtension').get(function() {
  return path.extname(this.file.originalName).toLowerCase();
});

// Virtual pour vérifier si le document est expiré
documentSchema.virtual('isExpired').get(function() {
  if (!this.expirationDate) return false;
  return new Date() > this.expirationDate;
});

// Virtual pour vérifier si c'est une image
documentSchema.virtual('isImage').get(function() {
  const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  return imageTypes.includes(this.file.mimeType);
});

// Virtual pour vérifier si c'est un PDF
documentSchema.virtual('isPDF').get(function() {
  return this.file.mimeType === 'application/pdf';
});

// Virtual pour obtenir l'URL de téléchargement
documentSchema.virtual('downloadUrl').get(function() {
  return `/api/documents/${this._id}/download`;
});

// Virtual pour obtenir l'URL de prévisualisation
documentSchema.virtual('previewUrl').get(function() {
  if (this.isImage || this.isPDF) {
    return `/api/documents/${this._id}/preview`;
  }
  return null;
});

// Méthode pour incrémenter le compteur de téléchargements
documentSchema.methods.incrementDownloadCount = function(userId) {
  this.downloadCount += 1;
  this.lastDownloaded = new Date();
  if (userId) {
    this.lastDownloadedBy = userId;
  }
  return this.save({ validateBeforeSave: false });
};

// Méthode pour ajouter une nouvelle version
documentSchema.methods.addVersion = function(fileData, userId, changelog) {
  const newVersion = {
    version: this.getNextVersion(),
    filename: fileData.filename,
    path: fileData.path,
    size: fileData.size,
    uploadedBy: userId,
    changelog: changelog || 'Nouvelle version'
  };
  
  this.versions.push(newVersion);
  this.metadata.version = newVersion.version;
  
  return this.save();
};

// Méthode pour obtenir le numéro de la prochaine version
documentSchema.methods.getNextVersion = function() {
  if (this.versions.length === 0) {
    return '1.1';
  }
  
  const lastVersion = this.versions[this.versions.length - 1].version;
  const parts = lastVersion.split('.');
  const minor = parseInt(parts[1]) + 1;
  
  return `${parts[0]}.${minor}`;
};

// Méthode pour archiver le document
documentSchema.methods.archive = function() {
  this.isArchived = true;
  this.status = 'archived';
  return this.save();
};

// Middleware pour définir automatiquement le type basé sur le MIME type
documentSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('file.mimeType')) {
    const mimeType = this.file.mimeType;
    
    if (mimeType.startsWith('image/')) {
      this.type = 'image';
    } else if (mimeType === 'application/pdf') {
      this.type = 'pdf';
    } else if (mimeType.includes('document') || mimeType.includes('text')) {
      this.type = 'document';
    } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      this.type = 'spreadsheet';
    } else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      this.type = 'presentation';
    } else if (mimeType.startsWith('video/')) {
      this.type = 'video';
    } else if (mimeType.startsWith('audio/')) {
      this.type = 'audio';
    } else if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive')) {
      this.type = 'archive';
    } else {
      this.type = 'autre';
    }
  }
  
  next();
});

module.exports = mongoose.model('Document', documentSchema);