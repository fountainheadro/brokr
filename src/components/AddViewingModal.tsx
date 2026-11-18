import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Calendar, Clock, User, Check, Loader2, AlertCircle } from 'lucide-react';
import { Contact } from '../services/contactsService';
import { viewingsService } from '../services/viewingsService';
import { toast } from 'react-hot-toast';
import { notificationsService } from '../services/notificationsService';

interface AddViewingModalProps {
  isOpen: boolean;
  onClose: () => void;
  propertyId: string;
  contacts: Contact[];
}

export const AddViewingModal: React.FC<AddViewingModalProps> = ({ isOpen, onClose, propertyId, contacts }) => {
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [date, setDate] = useState('');
  const [hour, setHour] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const potentialRenters = contacts.filter(c => c.type !== 'Owner' && c.type !== 'Agent');
  const availableAgents = contacts.filter(c => c.type === 'Agent');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContactId || !date || !hour) return;

    setIsSubmitting(true);
    setError(null);

    const contact = potentialRenters.find(c => c.id === selectedContactId);
    const agent = availableAgents.find(a => a.id === selectedAgentId);

    try {
      await viewingsService.addViewing({
        propertyId,
        contactId: selectedContactId,
        contactName: contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown',
        agentId: selectedAgentId || undefined,
        agentName: agent ? `${agent.firstName} ${agent.lastName}` : undefined,
        date,
        hour
      });

      await notificationsService.addNotification({
        title: 'Vizionare Programată',
        message: `Vizionare nouă cu ${contact ? `${contact.firstName} ${contact.lastName}` : 'un client'} pe data de ${date} la ora ${hour}.`,
        type: 'viewing'
      });

      toast.success('Vizionare programată cu succes!');
      onClose();
      // Reset form
      setSelectedContactId('');
      setDate('');
      setHour('');
    } catch (err) {
      setError('Eroare la programarea vizionării. Vă rugăm să încercați din nou.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 max-w-xl mx-auto bg-white rounded-t-[16px] z-[301] border-x border-t border-gray-100 shadow-2xl overflow-hidden max-h-[95vh] flex flex-col"
          >
            <div className="w-12 h-1 bg-gray-100 rounded-full mx-auto my-3 shrink-0" />
            
            <div className="p-5 flex items-center justify-between bg-white border-b border-gray-100 shrink-0">
              <h2 className="font-title text-[16px] font-semibold text-gray-900 tracking-tight">Programare Vizionare</h2>
              <button 
                onClick={onClose}
                className="w-10 h-10 flex items-center justify-center bg-white rounded-full text-gray-400 hover:text-gray-900 transition-colors border border-gray-100 shadow-sm"
              >
                <X size={20} strokeWidth={2.5} />
              </button>
            </div>
 
            <div className="p-8 pb-12 overflow-y-auto">
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-[16px] p-4 mb-6 flex items-start gap-3">
                  <AlertCircle size={18} className="text-red-500 shrink-0 mt-1" />
                  <p className="text-[13px] text-red-600 font-normal">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-8">
                <div>
                  <label className="block text-[12px] font-semibold text-gray-400 uppercase tracking-widest mb-4 ml-1">
                    Selectează Clientul
                  </label>
                  <div className="space-y-4">
                    {potentialRenters.length > 0 ? (
                      potentialRenters.map((contact, idx) => (
                        <button
                          key={contact.id || `${contact.firstName}-${contact.lastName}-${contact.phone}-${idx}`}
                          type="button"
                          onClick={() => setSelectedContactId(contact.id!)}
                          className={`w-full flex items-center justify-between p-4 rounded-[16px] border transition-all text-left ${
                            selectedContactId === contact.id
                              ? 'border-[--color-accent] bg-[--color-accent]/5 shadow-sm'
                              : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                              selectedContactId === contact.id 
                                ? 'bg-[--color-accent] border-[--color-accent] text-white shadow-sm' 
                                : 'bg-white border-gray-100 text-gray-400'
                            }`}>
                              <User size={18} />
                            </div>
                            <div>
                              <p className="text-[15px] font-normal text-gray-900">{contact.firstName} {contact.lastName}</p>
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{contact.type}</p>
                            </div>
                          </div>
                          {selectedContactId === contact.id && (
                            <div className="w-6 h-6 rounded-full bg-[--color-accent] flex items-center justify-center text-white shadow-sm">
                              <Check size={14} strokeWidth={3} />
                            </div>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="p-12 text-center bg-gray-50/50 rounded-[16px] border border-dashed border-gray-200">
                        <User size={32} className="text-gray-200 mx-auto mb-3" />
                        <p className="text-[14px] text-gray-400 font-normal tracking-wider">Niciun client alocat</p>
                      </div>
                    )}
                  </div>
                </div>

                {availableAgents.length > 0 && (
                  <div>
                    <label className="block text-[12px] font-semibold text-gray-400 uppercase tracking-widest mb-4 ml-1">
                      Asistent (Agent/Coleg)
                    </label>
                    <div className="space-y-4">
                      {availableAgents.map((agent, idx) => (
                        <button
                          key={agent.id || `${agent.firstName}-${agent.lastName}-${agent.phone}-${idx}`}
                          type="button"
                          onClick={() => setSelectedAgentId(selectedAgentId === agent.id ? '' : agent.id!)}
                          className={`w-full flex items-center justify-between p-4 rounded-[16px] border transition-all text-left ${
                            selectedAgentId === agent.id
                              ? 'border-[--color-brand-gold] bg-[--color-brand-gold-light] shadow-sm'
                              : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/50'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                              selectedAgentId === agent.id 
                                ? 'bg-[--color-brand-gold] border-[--color-brand-gold] text-white shadow-sm' 
                                : 'bg-white border-gray-100 text-gray-400'
                            }`}>
                              <User size={18} />
                            </div>
                            <div>
                              <p className="text-[15px] font-normal text-gray-900">{agent.firstName} {agent.lastName}</p>
                              <p className="text-[11px] font-normal text-gray-400 uppercase tracking-wider">{agent.phone}</p>
                            </div>
                          </div>
                          {selectedAgentId === agent.id && (
                            <div className="w-6 h-6 rounded-full bg-[--color-brand-gold] flex items-center justify-center text-white shadow-sm">
                              <Check size={14} strokeWidth={3} />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider uppercase ml-1">
                      Data
                    </label>
                    <div className="relative group">
                      <Calendar size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[--color-brand-gold] pointer-events-none transition-colors" />
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                        className="input-base w-full pl-14 pr-5 rounded-[8px] text-base font-normal text-gray-900"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[12px] font-semibold text-[--color-text-placeholder] tracking-wider uppercase ml-1">
                      Ora
                    </label>
                    <div className="relative group">
                      <Clock size={18} className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[--color-brand-gold] pointer-events-none transition-colors" />
                      <input
                        type="time"
                        value={hour}
                        onChange={(e) => setHour(e.target.value)}
                        required
                        className="input-base w-full pl-14 pr-5 rounded-[8px] text-base font-normal text-gray-900"
                      />
                    </div>
                  </div>
                </div>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={isSubmitting || !selectedContactId || !date || !hour}
                  className="w-full h-16 btn-brand-primary text-white rounded-full font-semibold text-[16px] flex items-center justify-center gap-3 shadow-lg disabled:opacity-50 mt-4 cursor-pointer"
                >
                  {isSubmitting ? (
                    <Loader2 size={24} className="animate-spin" />
                  ) : (
                    <>
                      <Check size={20} strokeWidth={3} />
                      <span>Programează Vizionare</span>
                    </>
                  )}
                </motion.button>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
