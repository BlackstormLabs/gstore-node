/*jshint -W030 */
'use strict';

const chai   = require('chai');
const expect = chai.expect;
const sinon  = require('sinon');
require('sinon-as-promised');
const extend = require('extend');

const ds = require('./mocks/datastore')();
const datastoreSerializer = require('../lib/serializer').Datastore;
const Schema = require('../lib').Schema;
const Model  = require('../lib/model');
const gstore = require('../lib');
gstore.connect(ds);

describe('Entity', () => {
    let clock;
    let schema;
    let ModelInstance;

    beforeEach(function() {
        clock = sinon.useFakeTimers();

        gstore.models       = {};
        gstore.modelSchemas = {};
        gstore.options      = {};

        schema = new Schema({
            name    : {type: 'string'},
            lastname: {type:'string'},
            password: {type: 'string', read: false}
        });

        schema.virtual('fullname').get(function() {
            return this.name + ' ' + this.lastname;
        });

        schema.virtual('fullname').set(function(name) {
            var split     = name.split(' ');
            this.name     = split[0];
            this.lastname = split[1];
        });

        ModelInstance = gstore.model('User', schema);

        sinon.stub(ds, 'save').resolves();
    });

    afterEach(function() {
        ds.save.restore();
        clock.restore();
    });

    describe.only('intantiate', function() {
        it('should initialized properties', (done) => {
            let model  = gstore.model('BlogPost', schema);

            let entity = new model({}, 'keyid');

            expect(entity.entityData).to.exist;
            expect(entity.entityKey).to.exist;
            expect(entity.schema).to.exist;
            expect(entity.excludeFromIndexes).deep.equal([]);
            expect(entity.pre).to.exist;
            expect(entity.post).to.exist;

            done();
        });

        it('should add data passed to entityData', () => {
            let model  = gstore.model('BlogPost', schema);

            let entity = new model({name:'John'});

            expect(entity.entityData.name).to.equal('John');
        });

        it('should not add any data if nothing is passed', () => {
            schema = new Schema({
                name    : {type: 'string', optional:true}
            });
            let model = gstore.model('BlogPost', schema);

            let entity = new model();

            expect(Object.keys(entity.entityData).length).to.equal(0);
        });

        it ('should set default values or null from schema', () => {
            schema = new Schema({
                name:{type:'string', default:'John'},
                lastname: {type: 'string'},
                email:{optional:true}
            });
            let model = gstore.model('BlogPost', schema);

            let entity = new model({});

            expect(entity.entityData.name).equal('John');
            expect(entity.entityData.lastname).equal(null);
            expect(entity.entityData.email).equal(undefined);
        });

        it('should call handler for default values in gstore.defaultValues constants', () => {
            clock.restore();
            sinon.spy(gstore.defaultValues, '__handler__');
            schema = new Schema({
                createdOn:{type:'dateTime', default:gstore.defaultValues.NOW}
            });
            let model = gstore.model('BlogPost', schema);

            let entity = new model({});

            expect(gstore.defaultValues.__handler__.calledOnce).be.true;
        });

        it ('should not add default to optional properties', () => {
            schema = new Schema({
                name:{type:'string'},
                email:{optional:true}
            });
            let model = gstore.model('BlogPost', schema);

            let entity = new model({});

            expect(entity.entityData.email).equal(undefined);
        });

        it ('should its array of excludeFromIndexes', () => {
            schema = new Schema({
                name    : {excludeFromIndexes:true},
                lastname: {excludeFromIndexes:true}
            });
            let model = gstore.model('BlogPost', schema);

            let entity = new model({name:'John'});

            expect(entity.excludeFromIndexes).deep.equal(['name', 'lastname']);
        });

        describe('should create Datastore Key', () => {
            let Model;

            beforeEach(() => {
                sinon.spy(ds, 'key');

                Model  = gstore.model('BlogPost', schema);
            });

            afterEach(() => {
                ds.key.restore();
            });

            it('---> with a full Key (String keyname passed)', () => {
                var entity = new Model({}, 'keyid');

                expect(entity.entityKey.kind).equal('BlogPost');
                expect(entity.entityKey.name).equal('keyid');
            });

            it('---> with a full Key (String with including numbers)', () => {
                var entity = new Model({}, '123:456');

                expect(entity.entityKey.name).equal('123:456');
            });

            it ('---> with a full Key (Integer keyname passed)', () => {
                var entity = new Model({}, 123);

                expect(entity.entityKey.id).equal(123);
            });

            it ('---> with a full Key ("string" Integer keyname passed)', () => {
                var entity = new Model({}, '123');

                expect(entity.entityKey.id).equal(123);
            });

            it ('---> throw error is id passed is not string or number', () => {
                let fn = () => {
                    var entity = new Model({}, {});
                };

                expect(fn).throw(Error);
            });

            it('---> with a partial Key (auto-generated id)', () => {
                var model = new Model({});

                expect(model.entityKey.kind).to.deep.equal('BlogPost');
            });

            it('---> with an ancestor path (auto-generated id)', () => {
                var entity = new Model({}, null, ['Parent', 1234]);

                expect(entity.entityKey.parent.kind).equal('Parent');
                expect(entity.entityKey.parent.id).equal(1234);
                expect(entity.entityKey.kind).equal('BlogPost');
            });

            it('---> with an ancestor path (manual id)', () => {
                var entity = new Model({}, 'entityKind', ['Parent', 1234]);

                expect(entity.entityKey.parent.kind).equal('Parent');
                expect(entity.entityKey.parent.id).equal(1234);
                expect(entity.entityKey.kind).equal('BlogPost');
                expect(entity.entityKey.name).equal('entityKind');
            });

            it('---> with a namespace', () => {
                let model = new Model({}, null, null, 'com.otherdomain');

                expect(model.entityKey.namespace).equal('com.otherdomain');
            });

            it('---> with a gcloud Key', () => {
                var key = ds.key('BlogPost', 1234);

                var entity = new Model({}, null, null, null, key);

                expect(entity.entityKey).equal(key);
            });

            it('---> throw error if key is not instance of Key', () => {
                function fn() {
                    new Model({}, null, null, null, {});
                }

                expect(fn).to.throw();
            });
        });

        describe('should register schema hooks', () => {
            let Model;
            let entity;
            let spyOn;

            beforeEach(() => {
                spyOn = {
                    fnHookPre: () => { return Promise.resolve(); },
                    fnHookPost: () => { return Promise.resolve(1234); }
                };

                sinon.spy(spyOn, 'fnHookPre');
                sinon.spy(spyOn, 'fnHookPost');
            });

            afterEach(() => {
                spyOn.fnHookPost.restore();
                spyOn.fnHookPre.restore();
            });

            it('should call pre hooks before saving and override arguments', () => {
                schema.pre('save', spyOn.fnHookPre);
                Model  = gstore.model('BlogPost', schema);
                entity = new Model({name:'John'});

                return entity.save().then((result) => {
                    expect(spyOn.fnHookPre.callCount).to.equal(1);
                });
            });

            it('should call pre and post hooks on custom method', () => {
                schema.method('newmethod', function() {
                    return Promise.resolve();
                });
                schema.pre('newmethod', spyOn.fnHookPre);
                schema.post('newmethod', spyOn.fnHookPost);
                Model  = gstore.model('BlogPost', schema);
                entity = new Model({name:'John'});

                return entity.newmethod().then(() => {
                    expect(spyOn.fnHookPre.callCount).to.equal(1);
                    expect(spyOn.fnHookPost.callCount).to.equal(1);
                });
            });

            it('should call post hooks after saving and override resolve', () => {
                schema.post('save', spyOn.fnHookPost);
                Model  = gstore.model('BlogPost', schema);
                entity = new Model({});

                return entity.save().then((result) => {
                    expect(spyOn.fnHookPost.called).be.true;
                    expect(result).equal(1234);
                });
            });

            it('should not do anything if no hooks on schema', function() {
                schema.callQueue = {model:{}, entity:{}};
                Model  = gstore.model('BlogPost', schema);
                entity = new Model({name:'John'});

                expect(entity.__pres).not.exist;
                expect(entity.__posts).not.exist;
            });

            it('should not register unknown methods', () => {
                schema.callQueue = {model:{}, entity:{}};
                schema.pre('unknown', () => {});
                Model  = gstore.model('BlogPost', schema);
                entity = new Model({});

                expect(entity.__pres).not.exist;
                expect(entity.__posts).not.exist;
            });
        });
    });

    describe('get / set', function() {
        var user;

        beforeEach(function() {
            user = new ModelInstance({name:'John', lastname:'Snow'});
        });

        it ('should get an entityData property', function() {
            let name = user.get('name');

            expect(name).equal('John');
        });

        it('should return virtual', () => {
            let fullname = user.get('fullname');

            expect(fullname).equal('John Snow');
        });

        it ('should set an entityData property', function() {
            user.set('name', 'Gregory');

            let name = user.get('name');

            expect(name).equal('Gregory');
        });

        it('should set virtual', () => {
            user.set('fullname', 'Peter Jackson');

            expect(user.entityData.name).equal('Peter');
        });
    });

    describe('plain()', function() {
        beforeEach(function() {
            sinon.spy(datastoreSerializer, 'fromDatastore')
        });

        afterEach(function() {
            datastoreSerializer.fromDatastore.restore();
        });

        it('should throw an error is options is not of type Object', () => {
            let fn = () => {
                var model  = new ModelInstance({name:'John'});
                let output = model.plain(true);
            }

            expect(fn).throw(Error);
        });

        it('should call datastoreSerializer "fromDatastore"', () => {
            var model      = new ModelInstance({name:'John', password:'test'});
            var entityKey  = model.entityKey;
            var entityData = model.entityData;

            let output = model.plain();

            expect(datastoreSerializer.fromDatastore.getCall(0).args[0]).deep.equal(entityData);
            expect(datastoreSerializer.fromDatastore.getCall(0).args[1]).equal(false);
            expect(output.password).not.exist;
        });

        it('should call datastoreSerializer "fromDatastore" passing readAll parameter', () => {
            var model = new ModelInstance({name:'John', password:'test'});

            let output = model.plain({readAll:true});

            expect(datastoreSerializer.fromDatastore.getCall(0).args[1]).equal(true);
            expect(output.password).exist;
        });

        it('should add virtuals', () => {
            var model = new ModelInstance({name:'John'});
            sinon.spy(model, 'addVirtuals');

            let output = model.plain({virtuals:true});

            expect(model.addVirtuals.called).be.true;
        });

    });

    describe('datastoreEntity()', function() {
        it('should get the data from the Datastore and merge it into the entity', function() {
            let mockData = {name:'John'};
            sinon.stub(ds, 'get', function(key, cb) {
                cb(null, mockData);
            });

            var model = new ModelInstance({});

            model.datastoreEntity((err, entity) => {
                expect(ds.get.called).be.true;
                expect(ds.get.getCall(0).args[0]).equal(model.entityKey);
                expect(entity.className).equal('Entity');
                expect(entity.entityData).equal(mockData);

                ds.get.restore();
            });
        });

        it ('should return 404 not found if no entity returned', () => {
            sinon.stub(ds, 'get', function(key, cb) {
                cb(null);
            });

            var model = new ModelInstance({});

            model.datastoreEntity((err, entity) => {
                expect(err.code).equal(404);
                expect(err.message).equal('Entity not found');
                ds.get.restore();
            });
        });

        it ('should deal with error while fetching the entity', function() {
            let error = {code:500, message:'Something went bad'};
            sinon.stub(ds, 'get', function(key, cb) {
                cb(error);
            });

            var model = new ModelInstance({});

            model.datastoreEntity((err) => {
                expect(err).equal(error);

                ds.get.restore();
            });
        });
    });

    describe('model()', () => {
        it('should be able to return model instances', () => {
            let imageSchema = new Schema({});
            let ImageModel  = gstore.model('Image', imageSchema);

            let blog = new ModelInstance({});

            expect(blog.model('Image')).equal(ImageModel);
        });

        it('should be able to execute methods from other model instances', () => {
            let imageSchema  = new Schema({});
            let ImageModel   = gstore.model('Image', imageSchema);
            let mockEntities = [{key : ds.key(['BlogPost', 1234])}];

            sinon.stub(ImageModel, 'get', (cb) => {
                cb(null, mockEntities[0]);
            });

            let blog = new ModelInstance({});

            blog.model('Image').get((err, entity) => {
                expect(entity).equal(mockEntities[0]);
            });
        });
    });

    describe('addVirtuals()', () => {
        var model;
        var User;

        beforeEach(() => {
            var schema = new Schema({firstname:{}, lastname:{}});

            schema.virtual('fullname').get(function() {
                return this.firstname + ' ' + this.lastname;
            });

            schema.virtual('fullname').set(function(name) {
                let split      = name.split(' ');
                this.firstname = split[0];
                this.lastname  = split[1];
            });

            User = gstore.model('Client', schema);

            model = new User({firstname:'John', lastname:'Snow'});
        });

        it('should create virtual (get) setting scope to entityData', () => {
            model.addVirtuals();

            expect(model.entityData.fullname).equal('John Snow');
        });

        it('should Not override', () => {
            model = new User({firstname:'John', lastname:'Snow', fullname:'Jooohn'});
            model.addVirtuals();

            expect(model.entityData.fullname).equal('Jooohn');
        });

        it('should read and parse virtual (set)', () => {
            model = new User({fullname:'John Snow'});

            model.addVirtuals();

            expect(model.entityData.firstname).equal('John');
            expect(model.entityData.lastname).equal('Snow');
        });

        it('should override existing', () => {
            model = new User({firstname:'Peter', fullname:'John Snow'});

            model.addVirtuals();

            expect(model.entityData.firstname).equal('John');
        });
    });
});
