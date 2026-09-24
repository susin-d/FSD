import mongoose from 'mongoose';

const ProviderSchema = new mongoose.Schema({
    user : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'User',
        required : true
    },
    service : {
        type : String,
        required : true
    },
    verified : {
        type : Boolean,
        default : false
    },
    verifiedBy : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'User',
    },
    rating : {
        type : Number,
        default : 0
    }
},{
        timestamps: true
});

const Provider = mongoose.model('Provider',ProviderSchema);

export default Provider;